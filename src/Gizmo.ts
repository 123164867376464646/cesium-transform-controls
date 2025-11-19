import type { Entity, Viewer } from 'cesium'
import {
  ArcType,
  BlendingState,
  BoxGeometry,
  Cartesian3,
  Math as CesiumMath,
  Color,
  ColorGeometryInstanceAttribute,
  CylinderGeometry,
  GeometryInstance,
  Material,
  MaterialAppearance,
  Matrix3,
  Matrix4,
  PerInstanceColorAppearance,
  PlaneGeometry,
  PolylineGeometry,
  PolylineMaterialAppearance,
  Primitive,
  Transforms,
} from 'cesium'
import { GizmoComponentPrimitive } from './GizmoComponentPrimitive'
import { addPointerEventHandler, computeCircle, removePointerEventHandler } from './utils'

/**
 * 通用的实体定位器接口
 * 用于在实体被重新创建后重新定位到原实体
 */
export interface MountedEntityLocator {
  entityId?: string
  // 扩展属性：允许业务层添加自定义标识符
  customProperties?: Record<string, any>
}

interface MountedVirtualPrimitive {
  modelMatrix: Matrix4
  _isEntity?: boolean
  _entity?: Entity
  _entityLocator?: MountedEntityLocator
}

export enum GizmoPart {
  xAxis = 'xAxis',
  yAxis = 'yAxis',
  zAxis = 'zAxis',
  xyPlane = 'xyPlane',
  xzPlane = 'xzPlane',
  yzPlane = 'yzPlane',
}

export enum GizmoMode {
  translate = 'translate',
  rotate = 'rotate',
  scale = 'scale',
}

export enum TranslateMode {
  local = 'local', // 使用物体自身坐标系
  surface = 'surface', // 使用地表切线坐标系
}

interface GizmoOptions {
  onGizmoPointerDown?: (event: PointerEvent) => void
  onGizmoPointerUp?: (event: PointerEvent) => void
  onGizmoPointerMove?: (event: PointerEvent) => void
}

export class Gizmo {
  mode: GizmoMode | null
  applyTransformationToMountedPrimitive: boolean
  modelMatrix: Matrix4
  length: number
  transMode: TranslateMode | null
  _viewer: Viewer | null
  _mountedPrimitive: Primitive | null
  _transPrimitives: GizmoComponentPrimitive | null
  _rotatePrimitives: GizmoComponentPrimitive | null
  _scalePrimitives: GizmoComponentPrimitive | null
  _xMaterial: Material
  _yMaterial: Material
  _zMaterial: Material
  _highlightMaterial: Material
  _helperMaterial: Material
  _xyPlaneMaterial: Material
  _xzPlaneMaterial: Material
  _yzPlaneMaterial: Material
  _planeHighlightMaterial: Material
  onGizmoPointerDown: ((event: PointerEvent) => void) | undefined
  onGizmoPointerUp: ((event: PointerEvent) => void) | undefined
  onGizmoPointerMove: ((event: PointerEvent) => void) | undefined
  autoSyncMountedPrimitive: boolean
  _isInteracting: boolean
  _lastSyncedPosition: Cartesian3 | null

  constructor(options?: GizmoOptions) {
    options = options || {}

    this.mode = null
    this.applyTransformationToMountedPrimitive = true
    this.modelMatrix = Matrix4.clone(Matrix4.IDENTITY, new Matrix4())
    this.length = 200 + 50 // gizmo pixel length;
    this.transMode = null

    this._viewer = null
    this._mountedPrimitive = null

    this._transPrimitives = null
    this._rotatePrimitives = null
    this._scalePrimitives = null

    // 0.99 for translucent PASS
    this._xMaterial = Material.fromType('Color', {
      color: new Color(1.0, 0.0, 0.0, 0.99),
    })
    this._yMaterial = Material.fromType('Color', {
      color: new Color(0.0, 1.0, 0.0, 0.99),
    })
    this._zMaterial = Material.fromType('Color', {
      color: new Color(0.0, 0.0, 1.0, 0.99),
    })
    this._highlightMaterial = Material.fromType('Color', {
      color: new Color(1.0, 1.0, 0.0, 0.99),
    })
    this._helperMaterial = Material.fromType('Color', {
      color: new Color(1.0, 1.0, 1.0, 0.5),
    })
    // Plane materials (semi-transparent)
    this._xyPlaneMaterial = Material.fromType('Color', {
      color: new Color(0.0, 0.0, 1.0, 0.6), // Blue for XY plane (Z axis)
    })
    this._xzPlaneMaterial = Material.fromType('Color', {
      color: new Color(0.0, 1.0, 0.0, 0.6), // Green for XZ plane (Y axis)
    })
    this._yzPlaneMaterial = Material.fromType('Color', {
      color: new Color(1.0, 0.0, 0.0, 0.6), // Red for YZ plane (X axis)
    })
    this._planeHighlightMaterial = Material.fromType('Color', {
      color: new Color(1.0, 1.0, 0.0, 0.5), // Yellow highlight for planes
    })

    this.onGizmoPointerDown = options.onGizmoPointerDown
    this.onGizmoPointerUp = options.onGizmoPointerUp
    this.onGizmoPointerMove = options.onGizmoPointerMove
    this.autoSyncMountedPrimitive = true
    this._isInteracting = false
    this._lastSyncedPosition = null

    this.createGizmoPrimitive()
  }

  createGizmoPrimitive() {
    // * create Translate Primitive
    const arrowLength = 0.2
    const arrowRadius = 0.06
    const lineLength = 0.8
    const lineRadius = 0.01

    // reuseable geometry。可以使用polyline Arrow，或者 polyline Volume！！！
    const arrowGeometry = new CylinderGeometry({
      length: arrowLength,
      topRadius: 0,
      bottomRadius: arrowRadius,
    })
    const lineGeometry = new CylinderGeometry({
      length: lineLength,
      topRadius: lineRadius,
      bottomRadius: lineRadius,
    })

    const xArrowModelMatrix = calTransModelMatrix(
      Cartesian3.UNIT_X,
      arrowLength / 2 + lineLength,
    )
    const xArrowNegModelMatrix = calTransModelMatrix(
      Cartesian3.negate(Cartesian3.UNIT_X, new Cartesian3()),
      arrowLength / 2 + lineLength,
    )
    const xLineModelMatrix = calTransModelMatrix(
      Cartesian3.UNIT_X,
      lineLength / 2,
    )
    const xLineNegModelMatrix = calTransModelMatrix(
      Cartesian3.negate(Cartesian3.UNIT_X, new Cartesian3()),
      lineLength / 2,
    )
    const yArrowModelMatrix = calTransModelMatrix(
      Cartesian3.UNIT_Y,
      arrowLength / 2 + lineLength,
    )
    const yArrowNegModelMatrix = calTransModelMatrix(
      Cartesian3.negate(Cartesian3.UNIT_Y, new Cartesian3()),
      arrowLength / 2 + lineLength,
    )
    const yLineModelMatrix = calTransModelMatrix(
      Cartesian3.UNIT_Y,
      lineLength / 2,
    )
    const yLineNegModelMatrix = calTransModelMatrix(
      Cartesian3.negate(Cartesian3.UNIT_Y, new Cartesian3()),
      lineLength / 2,
    )
    const zArrowModelMatrix = calTransModelMatrix(
      Cartesian3.UNIT_Z,
      arrowLength / 2 + lineLength,
    )
    const zArrowNegModelMatrix = calTransModelMatrix(
      Cartesian3.negate(Cartesian3.UNIT_Z, new Cartesian3()),
      arrowLength / 2 + lineLength,
    )
    const zLineModelMatrix = calTransModelMatrix(
      Cartesian3.UNIT_Z,
      lineLength / 2,
    )
    const zLineNegModelMatrix = calTransModelMatrix(
      Cartesian3.negate(Cartesian3.UNIT_Z, new Cartesian3()),
      lineLength / 2,
    )

    const xArrowInstance = new GeometryInstance({
      id: GizmoPart.xAxis,
      geometry: arrowGeometry,
      modelMatrix: xArrowModelMatrix,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(new Color(1.0, 0.0, 0.0, 0.99)),
      },
    })
    const xArrowNegInstance = new GeometryInstance({
      id: GizmoPart.xAxis,
      geometry: arrowGeometry,
      modelMatrix: xArrowNegModelMatrix,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(new Color(1.0, 0.0, 0.0, 0.99)),
      },
    })
    const xLineInstance = new GeometryInstance({
      id: GizmoPart.xAxis,
      geometry: lineGeometry,
      modelMatrix: xLineModelMatrix,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(new Color(1.0, 0.0, 0.0, 0.99)),
      },
    })
    const xLineNegInstance = new GeometryInstance({
      id: GizmoPart.xAxis,
      geometry: lineGeometry,
      modelMatrix: xLineNegModelMatrix,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(new Color(1.0, 0.0, 0.0, 0.01)),
      },
    })
    const yArrowInstance = new GeometryInstance({
      id: GizmoPart.yAxis,
      geometry: arrowGeometry,
      modelMatrix: yArrowModelMatrix,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(new Color(0.0, 1.0, 0.0, 0.99)),
      },
    })
    const yArrowNegInstance = new GeometryInstance({
      id: GizmoPart.yAxis,
      geometry: arrowGeometry,
      modelMatrix: yArrowNegModelMatrix,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(new Color(0.0, 1.0, 0.0, 0.99)),
      },
    })
    const yLineInstance = new GeometryInstance({
      id: GizmoPart.yAxis,
      geometry: lineGeometry,
      modelMatrix: yLineModelMatrix,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(new Color(0.0, 1.0, 0.0, 0.99)),
      },
    })
    const yLineNegInstance = new GeometryInstance({
      id: GizmoPart.yAxis,
      geometry: lineGeometry,
      modelMatrix: yLineNegModelMatrix,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(new Color(0.0, 1.0, 0.0, 0.01)),
      },
    })
    const zArrowInstance = new GeometryInstance({
      id: GizmoPart.zAxis,
      geometry: arrowGeometry,
      modelMatrix: zArrowModelMatrix,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(new Color(0.0, 0.0, 1.0, 0.99)),
      },
    })
    const zArrowNegInstance = new GeometryInstance({
      id: GizmoPart.zAxis,
      geometry: arrowGeometry,
      modelMatrix: zArrowNegModelMatrix,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(new Color(0.0, 0.0, 1.0, 0.99)),
      },
    })
    const zLineInstance = new GeometryInstance({
      id: GizmoPart.zAxis,
      geometry: lineGeometry,
      modelMatrix: zLineModelMatrix,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(new Color(0.0, 0.0, 1.0, 0.99)),
      },
    })
    const zLineNegInstance = new GeometryInstance({
      id: GizmoPart.zAxis,
      geometry: lineGeometry,
      modelMatrix: zLineNegModelMatrix,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(new Color(0.0, 0.0, 1.0, 0.01)),
      },
    })

    const gizmoRenderState = {
      depthTest: {
        enabled: false,
      },
      depthMask: false,
      blending: BlendingState.ALPHA_BLEND,
    }

    const gizmoModelMatrix = Matrix4.IDENTITY
    const xTransPrimitive = new Primitive({
      geometryInstances: [xArrowInstance, xLineInstance, xArrowNegInstance, xLineNegInstance],
      appearance: new PerInstanceColorAppearance({
        flat: true,
        translucent: true,
        renderState: gizmoRenderState,
      }),
      modelMatrix: gizmoModelMatrix,
      asynchronous: false,
    })
    const yTransPrimitive = new Primitive({
      geometryInstances: [yArrowInstance, yLineInstance, yArrowNegInstance, yLineNegInstance],
      appearance: new PerInstanceColorAppearance({
        flat: true,
        translucent: true,
        renderState: gizmoRenderState,
      }),
      modelMatrix: gizmoModelMatrix,
      asynchronous: false,
    })
    const zTransPrimitive = new Primitive({
      geometryInstances: [zArrowInstance, zLineInstance, zArrowNegInstance, zLineNegInstance],
      appearance: new PerInstanceColorAppearance({
        flat: true,
        translucent: true,
        renderState: gizmoRenderState,
      }),
      modelMatrix: gizmoModelMatrix,
      asynchronous: false,
    })

    const transPrimitive = new GizmoComponentPrimitive(
      this,
      GizmoMode.translate,
    )
    transPrimitive._part.push(
      xTransPrimitive,
      yTransPrimitive,
      zTransPrimitive,
    )
    this._transPrimitives = transPrimitive
    this._transPrimitives._show = false

    // * create helper lines for all modes
    const helperLength = 5000 // Very long line
    const createHelperLine = (axis: Cartesian3) => {
      const helperPoints = [
        Cartesian3.multiplyByScalar(axis, -helperLength / 2, new Cartesian3()),
        Cartesian3.multiplyByScalar(axis, helperLength / 2, new Cartesian3()),
      ]
      const helperGeometry = new PolylineGeometry({
        positions: helperPoints,
        width: 2,
        arcType: ArcType.NONE,
        vertexFormat: PolylineMaterialAppearance.VERTEX_FORMAT,
      })
      const helperInstance = new GeometryInstance({
        geometry: helperGeometry,
        modelMatrix: Matrix4.IDENTITY,
      })
      return new Primitive({
        geometryInstances: helperInstance,
        appearance: new PolylineMaterialAppearance({
          material: this._helperMaterial,
          renderState: gizmoRenderState,
        }),
        modelMatrix: Matrix4.IDENTITY,
        asynchronous: false,
        show: false, // Initially hidden
      })
    }

    // Helper lines for translate mode
    const xHelperLine = createHelperLine(Cartesian3.UNIT_X)
    const yHelperLine = createHelperLine(Cartesian3.UNIT_Y)
    const zHelperLine = createHelperLine(Cartesian3.UNIT_Z)

    transPrimitive._helper.push(xHelperLine, yHelperLine, zHelperLine)

    // * create Rotate Primitive
    const points = computeCircle(1)
    const circleGeometry = new PolylineGeometry({
      positions: points,
      width: 5,
      arcType: ArcType.NONE,
      vertexFormat: PolylineMaterialAppearance.VERTEX_FORMAT,
    })
    const xModelMatrix = calTransModelMatrix(Cartesian3.UNIT_X, 0)
    const yModelMatrix = calTransModelMatrix(Cartesian3.UNIT_Y, 0)
    const zModelMatrix = calTransModelMatrix(Cartesian3.UNIT_Z, 0)

    const xCircleInstance = new GeometryInstance({
      id: GizmoPart.xAxis,
      geometry: circleGeometry,
      modelMatrix: xModelMatrix,
    })
    const yCircleInstance = new GeometryInstance({
      id: GizmoPart.yAxis,
      geometry: circleGeometry,
      modelMatrix: yModelMatrix,
    })
    const zCircleInstance = new GeometryInstance({
      id: GizmoPart.zAxis,
      geometry: circleGeometry,
      modelMatrix: zModelMatrix,
    })

    const xRotatePrimitive = new Primitive({
      geometryInstances: xCircleInstance,
      appearance: new PolylineMaterialAppearance({
        material: this._xMaterial,
        renderState: gizmoRenderState,
      }),
      modelMatrix: gizmoModelMatrix,
      asynchronous: false,
    })
    const yRotatePrimitive = new Primitive({
      geometryInstances: yCircleInstance,
      appearance: new PolylineMaterialAppearance({
        material: this._yMaterial,
        renderState: gizmoRenderState,
      }),
      modelMatrix: gizmoModelMatrix,
      asynchronous: false,
    })
    const zRotatePrimitive = new Primitive({
      geometryInstances: zCircleInstance,
      appearance: new PolylineMaterialAppearance({
        material: this._zMaterial,
        renderState: gizmoRenderState,
      }),
      modelMatrix: gizmoModelMatrix,
      asynchronous: false,
    })
    const rotatePrimitive = new GizmoComponentPrimitive(this, GizmoMode.rotate)
    rotatePrimitive._part.push(
      xRotatePrimitive,
      yRotatePrimitive,
      zRotatePrimitive,
    )
    this._rotatePrimitives = rotatePrimitive

    // * create helper lines for rotate mode (axis lines)
    const xRotateHelperLine = createHelperLine(Cartesian3.UNIT_X)
    const yRotateHelperLine = createHelperLine(Cartesian3.UNIT_Y)
    const zRotateHelperLine = createHelperLine(Cartesian3.UNIT_Z)

    rotatePrimitive._helper.push(xRotateHelperLine, yRotateHelperLine, zRotateHelperLine)

    // * create Scale Primitive
    const boxGeometry = BoxGeometry.fromDimensions({
      dimensions: new Cartesian3(
        arrowLength / 2,
        arrowLength / 2,
        arrowLength / 2,
      ),
    })
    const xBoxModelMatrix = calTransModelMatrix(Cartesian3.UNIT_X, lineLength)
    const yBoxModelMatrix = calTransModelMatrix(Cartesian3.UNIT_Y, lineLength)
    const zBoxModelMatrix = calTransModelMatrix(Cartesian3.UNIT_Z, lineLength)

    // Negative direction boxes
    const xBoxNegModelMatrix = calTransModelMatrix(
      Cartesian3.negate(Cartesian3.UNIT_X, new Cartesian3()),
      lineLength,
    )
    const yBoxNegModelMatrix = calTransModelMatrix(
      Cartesian3.negate(Cartesian3.UNIT_Y, new Cartesian3()),
      lineLength,
    )
    const zBoxNegModelMatrix = calTransModelMatrix(
      Cartesian3.negate(Cartesian3.UNIT_Z, new Cartesian3()),
      lineLength,
    )

    const xBoxInstance = new GeometryInstance({
      id: GizmoPart.xAxis,
      geometry: boxGeometry,
      modelMatrix: xBoxModelMatrix,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(new Color(1.0, 0.0, 0.0, 0.99)),
      },
    })
    const yBoxInstance = new GeometryInstance({
      id: GizmoPart.yAxis,
      geometry: boxGeometry,
      modelMatrix: yBoxModelMatrix,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(new Color(0.0, 1.0, 0.0, 0.99)),
      },
    })
    const zBoxInstance = new GeometryInstance({
      id: GizmoPart.zAxis,
      geometry: boxGeometry,
      modelMatrix: zBoxModelMatrix,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(new Color(0.0, 0.0, 1.0, 0.99)),
      },
    })
    const xBoxNegInstance = new GeometryInstance({
      id: GizmoPart.xAxis,
      geometry: boxGeometry,
      modelMatrix: xBoxNegModelMatrix,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(new Color(1.0, 0.0, 0.0, 0.99)),
      },
    })
    const yBoxNegInstance = new GeometryInstance({
      id: GizmoPart.yAxis,
      geometry: boxGeometry,
      modelMatrix: yBoxNegModelMatrix,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(new Color(0.0, 1.0, 0.0, 0.99)),
      },
    })
    const zBoxNegInstance = new GeometryInstance({
      id: GizmoPart.zAxis,
      geometry: boxGeometry,
      modelMatrix: zBoxNegModelMatrix,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(new Color(0.0, 0.0, 1.0, 0.99)),
      },
    })
    const xScalePrimitive = new Primitive({
      geometryInstances: [xBoxInstance, xLineInstance, xBoxNegInstance, xLineNegInstance],
      appearance: new PerInstanceColorAppearance({
        flat: true,
        translucent: true,
        renderState: gizmoRenderState,
      }),
      modelMatrix: gizmoModelMatrix,
      asynchronous: false,
    })
    const yScalePrimitive = new Primitive({
      geometryInstances: [yBoxInstance, yLineInstance, yBoxNegInstance, yLineNegInstance],
      appearance: new PerInstanceColorAppearance({
        flat: true,
        translucent: true,
        renderState: gizmoRenderState,
      }),
      modelMatrix: gizmoModelMatrix,
      asynchronous: false,
    })
    const zScalePrimitive = new Primitive({
      geometryInstances: [zBoxInstance, zLineInstance, zBoxNegInstance, zLineNegInstance],
      appearance: new PerInstanceColorAppearance({
        flat: true,
        translucent: true,
        renderState: gizmoRenderState,
      }),
      modelMatrix: gizmoModelMatrix,
      asynchronous: false,
    })
    const scalePrimitive = new GizmoComponentPrimitive(this, GizmoMode.scale)
    scalePrimitive._part.push(
      xScalePrimitive,
      yScalePrimitive,
      zScalePrimitive,
    )
    this._scalePrimitives = scalePrimitive

    // * create helper lines for scale mode
    const xScaleHelperLine = createHelperLine(Cartesian3.UNIT_X)
    const yScaleHelperLine = createHelperLine(Cartesian3.UNIT_Y)
    const zScaleHelperLine = createHelperLine(Cartesian3.UNIT_Z)

    scalePrimitive._helper.push(xScaleHelperLine, yScaleHelperLine, zScaleHelperLine)

    // * create Plane Primitives for translate and scale
    const planeSize = 0.3
    const planeOffset = lineLength * 0.4 // Position at middle of axes

    // XY Plane (for Z axis manipulation) - positioned at X and Y intersection
    // No rotation needed, default plane is in XY
    const xyPlaneGeometry = new PlaneGeometry({
      vertexFormat: MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat,
    })
    const xyPlaneScale = Matrix4.fromScale(
      new Cartesian3(planeSize, planeSize, 1),
      new Matrix4(),
    )
    const xyPlaneTranslate = Matrix4.fromTranslation(
      new Cartesian3(planeOffset, planeOffset, 0),
      new Matrix4(),
    )
    const xyPlaneModelMatrix = Matrix4.multiply(
      xyPlaneTranslate,
      xyPlaneScale,
      new Matrix4(),
    )
    const xyPlaneInstance = new GeometryInstance({
      id: GizmoPart.xyPlane,
      geometry: xyPlaneGeometry,
      modelMatrix: xyPlaneModelMatrix,
    })

    // XZ Plane (for Y axis manipulation) - positioned at X and Z intersection
    // Rotate 90 degrees around X axis to align with XZ plane
    const xzPlaneGeometry = new PlaneGeometry({
      vertexFormat: MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat,
    })
    const xzPlaneScale = Matrix4.fromScale(
      new Cartesian3(planeSize, planeSize, 1),
      new Matrix4(),
    )
    const xzPlaneRotation = Matrix4.fromRotationTranslation(
      Matrix3.fromRotationX(CesiumMath.toRadians(90)),
      new Cartesian3(planeOffset, 0, planeOffset),
    )
    const xzPlaneModelMatrix = Matrix4.multiply(
      xzPlaneRotation,
      xzPlaneScale,
      new Matrix4(),
    )
    const xzPlaneInstance = new GeometryInstance({
      id: GizmoPart.xzPlane,
      geometry: xzPlaneGeometry,
      modelMatrix: xzPlaneModelMatrix,
    })

    // YZ Plane (for X axis manipulation) - positioned at Y and Z intersection
    // Rotate 90 degrees around Y axis to align with YZ plane
    const yzPlaneGeometry = new PlaneGeometry({
      vertexFormat: MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat,
    })
    const yzPlaneScale = Matrix4.fromScale(
      new Cartesian3(planeSize, planeSize, 1),
      new Matrix4(),
    )
    const yzPlaneRotation = Matrix4.fromRotationTranslation(
      Matrix3.fromRotationY(CesiumMath.toRadians(90)),
      new Cartesian3(0, planeOffset, planeOffset),
    )
    const yzPlaneModelMatrix = Matrix4.multiply(
      yzPlaneRotation,
      yzPlaneScale,
      new Matrix4(),
    )
    const yzPlaneInstance = new GeometryInstance({
      id: GizmoPart.yzPlane,
      geometry: yzPlaneGeometry,
      modelMatrix: yzPlaneModelMatrix,
    })

    // Create plane primitives
    const xyPlanePrimitive = new Primitive({
      geometryInstances: xyPlaneInstance,
      appearance: new MaterialAppearance({
        material: this._xyPlaneMaterial,
        renderState: gizmoRenderState,
      }),
      modelMatrix: gizmoModelMatrix,
      asynchronous: false,
    })

    const xzPlanePrimitive = new Primitive({
      geometryInstances: xzPlaneInstance,
      appearance: new MaterialAppearance({
        material: this._xzPlaneMaterial,
        renderState: gizmoRenderState,
      }),
      modelMatrix: gizmoModelMatrix,
      asynchronous: false,
    })

    const yzPlanePrimitive = new Primitive({
      geometryInstances: yzPlaneInstance,
      appearance: new MaterialAppearance({
        material: this._yzPlaneMaterial,
        renderState: gizmoRenderState,
      }),
      modelMatrix: gizmoModelMatrix,
      asynchronous: false,
    })

    // Store plane primitives in both translate and scale
    transPrimitive._part.push(xyPlanePrimitive, xzPlanePrimitive, yzPlanePrimitive)
    scalePrimitive._part.push(xyPlanePrimitive, xzPlanePrimitive, yzPlanePrimitive)
  }

  /**
   * 从挂载的 Primitive/Entity 同步位置到 Gizmo
   * 只在不处于交互状态且启用自动同步时更新
   * 但如果检测到外部修改（通过位置变化检测），即使在交互状态也会更新
   */
  updateModelMatrixFromMountedPrimitive() {
    if (!this.autoSyncMountedPrimitive || !this._mountedPrimitive)
      return

    // Keep gizmo aligned with the current mounted primitive (entity or primitive)
    const mounted = this._mountedPrimitive as MountedVirtualPrimitive
    if (mounted._isEntity) {
      const entity = this.resolveMountedEntity(mounted)
      if (!entity || !entity.position || !this._viewer)
        return

      if (!mounted._entityLocator) {
        mounted._entityLocator = this.buildEntityLocator(entity)
      }

      const time = this._viewer.clock?.currentTime
      const position = entity.position.getValue(time)
      if (!position)
        return

      // 检测位置是否发生外部变化（使用更宽松的epsilon以提高检测灵敏度）
      const hasExternalChange = this._lastSyncedPosition
        && !Cartesian3.equalsEpsilon(position, this._lastSyncedPosition, 0.01)

      // 如果正在交互且没有外部变化，则不更新
      if (this._isInteracting && !hasExternalChange)
        return

      // 只有当位置真正变化时才更新
      if (hasExternalChange || !this._lastSyncedPosition) {
        // 更新 Gizmo 位置
        const transform = Transforms.eastNorthUpToFixedFrame(position)
        Matrix4.clone(transform, this.modelMatrix)

        // 记录当前同步的位置
        this._lastSyncedPosition = Cartesian3.clone(position, this._lastSyncedPosition || new Cartesian3())
      }
    }
    else if (mounted.modelMatrix) {
      // 如果正在交互，则不更新 Primitive 的位置
      if (this._isInteracting)
        return

      Matrix4.clone(mounted.modelMatrix, this.modelMatrix)
    }
  }

  /**
   * 强制从挂载对象同步位置，即使在交互状态也会更新
   * 用于外部编辑器修改实体位置后的同步
   */
  forceSyncFromMountedPrimitive() {
    if (!this._mountedPrimitive)
      return

    const mounted = this._mountedPrimitive as MountedVirtualPrimitive
    if (mounted._isEntity) {
      const entity = this.resolveMountedEntity(mounted)
      if (!entity || !entity.position || !this._viewer)
        return

      const time = this._viewer.clock?.currentTime
      const position = entity.position.getValue(time)
      if (!position)
        return

      const transform = Transforms.eastNorthUpToFixedFrame(position)
      Matrix4.clone(transform, this.modelMatrix)
    }
    else if (mounted.modelMatrix) {
      Matrix4.clone(mounted.modelMatrix, this.modelMatrix)
    }
  }

  mountToEntity(entity: Entity, viewer?: Viewer | null) {
    if (!entity || !entity.position)
      return

    const currentViewer = viewer || this._viewer
    if (!currentViewer)
      return

    const time = currentViewer.clock?.currentTime
    const position = entity.position.getValue(time)
    if (!position)
      return

    const transform = Transforms.eastNorthUpToFixedFrame(position)
    const virtualPrimitive: MountedVirtualPrimitive = {
      modelMatrix: transform.clone(),
      _isEntity: true,
      _entity: entity,
      _entityLocator: this.buildEntityLocator(entity),
    }

    this._mountedPrimitive = virtualPrimitive as unknown as Primitive
    Matrix4.clone(transform, this.modelMatrix)
    this.autoSyncMountedPrimitive = true
    this._lastSyncedPosition = position.clone()

    if (this._transPrimitives) {
      this._transPrimitives._show = true
    }
  }

  /**
   * 挂载到 Primitive（如 Model）
   * @param primitive - 要挂载的 primitive（必须有 modelMatrix 属性）
   * @param viewer - Viewer 实例
   */
  mountToPrimitive(primitive: any, viewer?: Viewer | null) {
    if (!primitive || !primitive.modelMatrix)
      return

    const currentViewer = viewer || this._viewer
    if (!currentViewer)
      return

    // 直接使用 primitive 的 modelMatrix
    this._mountedPrimitive = primitive
    Matrix4.clone(primitive.modelMatrix, this.modelMatrix)
    this.autoSyncMountedPrimitive = true

    if (this._transPrimitives) {
      this._transPrimitives._show = true
    }
  }

  attach(viewer: Viewer) {
    this._viewer = viewer
    if (this._transPrimitives) {
      this._viewer.scene.primitives.add(this._transPrimitives)
    }
    if (this._rotatePrimitives) {
      this._viewer.scene.primitives.add(this._rotatePrimitives)
    }
    if (this._scalePrimitives) {
      this._viewer.scene.primitives.add(this._scalePrimitives)
    }

    // Add helper lines to scene
    if (this._transPrimitives) {
      for (const h of this._transPrimitives._helper) {
        this._viewer.scene.primitives.add(h)
      }
    }
    if (this._rotatePrimitives) {
      for (const h of this._rotatePrimitives._helper) {
        this._viewer.scene.primitives.add(h)
      }
    }
    if (this._scalePrimitives) {
      for (const h of this._scalePrimitives._helper) {
        this._viewer.scene.primitives.add(h)
      }
    }

    this.setMode(GizmoMode.translate)
    this.transMode = TranslateMode.local
    addPointerEventHandler(this._viewer, this)
  }

  // 必须在viewer销毁之前调用
  detach() {
    if (!this._viewer)
      return
    // Remove helper lines from scene
    if (this._transPrimitives) {
      for (const h of this._transPrimitives._helper) {
        this._viewer.scene.primitives.remove(h)
      }
    }
    if (this._rotatePrimitives) {
      for (const h of this._rotatePrimitives._helper) {
        this._viewer.scene.primitives.remove(h)
      }
    }
    if (this._scalePrimitives) {
      for (const h of this._scalePrimitives._helper) {
        this._viewer.scene.primitives.remove(h)
      }
    }

    if (this._transPrimitives) {
      this._viewer.scene.primitives.remove(this._transPrimitives)
    }
    if (this._rotatePrimitives) {
      this._viewer.scene.primitives.remove(this._rotatePrimitives)
    }
    if (this._scalePrimitives) {
      this._viewer.scene.primitives.remove(this._scalePrimitives)
    }
    this._viewer = null
    removePointerEventHandler()
  }

  isGizmoPrimitive(primitive: Primitive) {
    return (
      (this._transPrimitives?._part.includes(primitive) ?? false)
      || (this._rotatePrimitives?._part.includes(primitive) ?? false)
      || (this._scalePrimitives?._part.includes(primitive) ?? false)
    )
  }

  setMode(mode: GizmoMode) {
    if (mode === GizmoMode.translate) {
      this.mode = GizmoMode.translate
      if (this._transPrimitives) {
        this._transPrimitives._show = true
      }
      if (this._rotatePrimitives) {
        this._rotatePrimitives._show = false
      }
      if (this._scalePrimitives) {
        this._scalePrimitives._show = false
      }
    }
    else if (mode === GizmoMode.rotate) {
      this.mode = GizmoMode.rotate
      if (this._transPrimitives) {
        this._transPrimitives._show = false
      }
      if (this._rotatePrimitives) {
        this._rotatePrimitives._show = true
      }
      if (this._scalePrimitives) {
        this._scalePrimitives._show = false
      }
    }
    else if (mode === GizmoMode.scale) {
      this.mode = GizmoMode.scale
      if (this._transPrimitives) {
        this._transPrimitives._show = false
      }
      if (this._rotatePrimitives) {
        this._rotatePrimitives._show = false
      }
      if (this._scalePrimitives) {
        this._scalePrimitives._show = true
      }
    }
  }

  /**
   * Show/hide helper line for specific axis
   * @param {string|string[]|null} axisId - GizmoPart.xAxis, yAxis, zAxis, array of axes, or null to hide all
   */
  setHelperLineVisible(axisId: GizmoPart | GizmoPart[] | null) {
    let currentPrimitives
    if (this.mode === GizmoMode.translate) {
      currentPrimitives = this._transPrimitives
    }
    else if (this.mode === GizmoMode.rotate) {
      currentPrimitives = this._rotatePrimitives
    }
    else if (this.mode === GizmoMode.scale) {
      currentPrimitives = this._scalePrimitives
    }

    if (!currentPrimitives) {
      return
    }

    // Hide all helper lines first
    for (let i = 0; i < currentPrimitives._helper.length; i++) {
      currentPrimitives._helper[i].show = false
    }

    // Support array of axis IDs for plane operations
    const axisIds = Array.isArray(axisId) ? axisId : [axisId]

    for (const id of axisIds) {
      // Show specific helper line
      if (id === GizmoPart.xAxis) {
        currentPrimitives._helper[0].show = true
      }
      else if (id === GizmoPart.yAxis) {
        currentPrimitives._helper[1].show = true
      }
      else if (id === GizmoPart.zAxis) {
        currentPrimitives._helper[2].show = true
      }
    }
  }

  /**
   * 构建实体定位器（通用实现）
   * 可以通过回调函数自定义定位逻辑
   */
  private buildEntityLocator(entity: Entity | undefined): MountedEntityLocator | undefined {
    if (!entity)
      return undefined

    const locator: MountedEntityLocator = {}
    let hasData = false

    if (entity.id) {
      locator.entityId = entity.id
      hasData = true
    }

    // 收集所有自定义属性
    const customProperties: Record<string, any> = {}
    for (const key in entity) {
      // 跳过 Cesium 内部属性和方法
      if (!key.startsWith('_') && typeof (entity as any)[key] !== 'function' && key !== 'id') {
        const value = (entity as any)[key]
        // 只保存基础类型的自定义属性（可用作标识符）
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          customProperties[key] = value
        }
      }
    }

    if (Object.keys(customProperties).length > 0) {
      locator.customProperties = customProperties
      hasData = true
    }

    return hasData ? locator : undefined
  }

  /**
   * 解析挂载的实体（通用实现）
   * 尝试通过定位器重新找到实体
   */
  private resolveMountedEntity(mounted: MountedVirtualPrimitive): Entity | undefined {
    if (!this._viewer)
      return mounted._entity

    const hasValidEntity = mounted._entity
      && this._viewer.entities.contains(mounted._entity)

    if (hasValidEntity) {
      return mounted._entity
    }

    const locator = mounted._entityLocator
    if (!locator)
      return mounted._entity

    // 首先尝试通过 entityId 查找
    if (locator.entityId) {
      const foundById = this._viewer.entities.getById(locator.entityId) as Entity | undefined
      if (foundById) {
        mounted._entity = foundById
        return foundById
      }
    }

    // 如果有自定义属性，尝试通过自定义属性匹配
    if (locator.customProperties) {
      const found = this._viewer.entities.values.find((entity: any) => {
        // 检查所有自定义属性是否匹配
        return Object.entries(locator.customProperties!).every(([key, value]) => {
          return entity[key] === value
        })
      })
      if (found) {
        // 更新引用
        mounted._entity = found
        console.log('Gizmo: Entity 已重新定位（通过自定义属性）', found)
        return found
      }
    }

    return mounted._entity
  }
}

function calTransModelMatrix(axis: Cartesian3, translate: number): Matrix4 {
  const modelMatrix = Matrix4.clone(Matrix4.IDENTITY, new Matrix4())
  if (Cartesian3.equals(axis, Cartesian3.UNIT_X)) {
    const rotation = Matrix3.fromRotationY(CesiumMath.toRadians(90))
    const translation = Cartesian3.fromElements(translate, 0, 0)
    Matrix4.setTranslation(modelMatrix, translation, modelMatrix)
    Matrix4.setRotation(modelMatrix, rotation, modelMatrix)
  }
  else if (Cartesian3.equals(axis, Cartesian3.negate(Cartesian3.UNIT_X, new Cartesian3()))) {
    console.log(translate)
    const rotation = Matrix3.fromRotationY(CesiumMath.toRadians(-90))
    const translation = Cartesian3.fromElements(-translate, +0.0001, 0)//TODO: 解决Z轴线渲染时Z-fighting问题
    Matrix4.setTranslation(modelMatrix, translation, modelMatrix)
    Matrix4.setRotation(modelMatrix, rotation, modelMatrix)
  }
  else if (Cartesian3.equals(axis, Cartesian3.UNIT_Y)) {
    const rotation = Matrix3.fromRotationX(CesiumMath.toRadians(-90))
    const translation = Cartesian3.fromElements(0, translate, 0)
    Matrix4.setTranslation(modelMatrix, translation, modelMatrix)
    Matrix4.setRotation(modelMatrix, rotation, modelMatrix)
  }
  else if (Cartesian3.equals(axis, Cartesian3.negate(Cartesian3.UNIT_Y, new Cartesian3()))) {
    const rotation = Matrix3.fromRotationX(CesiumMath.toRadians(90))
    const translation = Cartesian3.fromElements(0, -translate, 0)
    Matrix4.setTranslation(modelMatrix, translation, modelMatrix)
    Matrix4.setRotation(modelMatrix, rotation, modelMatrix)
  }
  else if (Cartesian3.equals(axis, Cartesian3.UNIT_Z)) {
    const rotation = Matrix3.IDENTITY
    const translation = Cartesian3.fromElements(0, 0, translate)
    Matrix4.setTranslation(modelMatrix, translation, modelMatrix)
    Matrix4.setRotation(modelMatrix, rotation, modelMatrix)
  }
  else if (Cartesian3.equals(axis, Cartesian3.negate(Cartesian3.UNIT_Z, new Cartesian3()))) {
    const rotation = Matrix3.fromRotationY(CesiumMath.toRadians(180))
    const translation = Cartesian3.fromElements(0, 0, -translate)
    Matrix4.setTranslation(modelMatrix, translation, modelMatrix)
    Matrix4.setRotation(modelMatrix, rotation, modelMatrix)
  }
  return modelMatrix
}
