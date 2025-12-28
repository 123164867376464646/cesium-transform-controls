import type { Entity, Viewer } from 'cesium'
import * as CesiumInternal from 'cesium'
import {
  ArcType,
  AxisAlignedBoundingBox,
  BlendingState,
  BoxGeometry,
  BoxOutlineGeometry,
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
import { addPointerEventHandler, buildEntityLocator, computeCircle, removePointerEventHandler } from './utils'

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
  _isNode?: boolean
  _node?: any
  _model?: any
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

export enum CoordinateMode {
  local = 'local', // 使用物体自身坐标系
  surface = 'surface', // 使用地表切线坐标系（ENU）
}

interface GizmoOptions {
  onGizmoPointerDown?: (event: PointerEvent) => void
  onGizmoPointerUp?: (event: PointerEvent) => void
  onGizmoPointerMove?: (event: PointerEvent) => void
  // 包围盒显示选项
  showLocalBounds?: boolean // 显示模型空间边界，默认 false
  showWorldAABB?: boolean // 显示世界空间AABB，默认 false
  localBoundsColor?: Color // LocalBounds 颜色，默认 ORANGE
  worldAABBColor?: Color // WorldAABB 颜色，默认 CYAN
}

export class Gizmo {
  mode: GizmoMode | null
  applyTransformationToMountedPrimitive: boolean
  modelMatrix: Matrix4
  length: number
  coordinateMode: CoordinateMode | null
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
  _enabled: boolean
  // === 包围盒相关属性 ===
  _showLocalBounds: boolean
  _showWorldAABB: boolean
  _localBoundsColor: Color
  _worldAABBColor: Color
  _localBoundsPrimitive: Primitive | null
  _worldAABBPrimitive: Primitive | null
  _currentBounds: { min: Cartesian3, max: Cartesian3 } | null
  // 缓存相关属性
  _cachedModelBounds: { min: Cartesian3, max: Cartesian3 } | null
  _lastBoundingBoxUpdateMatrix: Matrix4 | null

  constructor(options?: GizmoOptions) {
    options = options || {}

    this.mode = null
    this.applyTransformationToMountedPrimitive = true
    this.modelMatrix = Matrix4.clone(Matrix4.IDENTITY, new Matrix4())
    this.length = 200 + 50 // Gizmo 像素长度;
    this.coordinateMode = null

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
      color: new Color(0.0, 0.0, 1.0, 0.6), // XY 平面颜色 (蓝色 - Z轴)
    })
    this._xzPlaneMaterial = Material.fromType('Color', {
      color: new Color(0.0, 1.0, 0.0, 0.6), // XZ 平面颜色 (绿色 - Y轴)
    })
    this._yzPlaneMaterial = Material.fromType('Color', {
      color: new Color(1.0, 0.0, 0.0, 0.6), // YZ 平面颜色 (红色 - X轴)
    })
    this._planeHighlightMaterial = Material.fromType('Color', {
      color: new Color(1.0, 1.0, 0.0, 0.5), // 平面高亮颜色 (黄色)
    })

    this.onGizmoPointerDown = options.onGizmoPointerDown
    this.onGizmoPointerUp = options.onGizmoPointerUp
    this.onGizmoPointerMove = options.onGizmoPointerMove
    this.autoSyncMountedPrimitive = true
    this._isInteracting = false
    this._lastSyncedPosition = null
    this._enabled = true

    // 包围盒初始化
    this._showLocalBounds = options.showLocalBounds ?? false
    this._showWorldAABB = options.showWorldAABB ?? false
    this._localBoundsColor = options.localBoundsColor ?? Color.ORANGE
    this._worldAABBColor = options.worldAABBColor ?? Color.CYAN
    this._localBoundsPrimitive = null
    this._worldAABBPrimitive = null
    this._currentBounds = null
    this._cachedModelBounds = null
    this._lastBoundingBoxUpdateMatrix = null

    this.createGizmoPrimitive()
  }

  createGizmoPrimitive() {
    // * create Translate Primitive
    const arrowLength = 0.2
    const arrowRadius = 0.06
    const lineLength = 0.8
    const lineRadius = 0.01

    // 可复用的几何体。可以使用 polyline Arrow，或者 polyline Volume
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

    // * 创建辅助线（所有模式通用）
    const helperLength = 5000 // 非常长的辅助线
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
        show: false, // 初始隐藏
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

    // XY 平面 (用于 Z 轴操作) - 位于 X 和 Y 的交汇处
    // 不需要旋转，默认平面就在 XY 平面上
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

    // XZ 平面 (用于 Y 轴操作) - 位于 X 和 Z 的交汇处
    // 绕 X 轴旋转 90 度以对齐 XZ 平面
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

    // YZ 平面 (用于 X 轴操作) - 位于 Y 和 Z 的交汇处
    // 绕 Y 轴旋转 90 度以对齐 YZ 平面
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

    // 将平面图元存储在平移和缩放组件中
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

    // 保持 Gizmo 与当前挂载的图元（Entity 或 Primitive）对齐
    const mounted = this._mountedPrimitive as MountedVirtualPrimitive
    if (mounted._isEntity) {
      const entity = this.resolveMountedEntity(mounted)
      if (!entity || !entity.position || !this._viewer)
        return

      if (!mounted._entityLocator) {
        mounted._entityLocator = buildEntityLocator(entity)
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
      // 节点类型不需要自动同步，因为有特殊的scale处理逻辑
      if ((mounted as any)._isNode) {
        return
      }

      // 如果正在交互，则不更新 Primitive 的位置
      if (this._isInteracting)
        return

      // 同步时移除缩放分量，确保 Gizmo 不会因为 Model 的缩放而变形
      const position = Matrix4.getTranslation(mounted.modelMatrix, new Cartesian3())
      const rotationWithScale = Matrix4.getMatrix3(mounted.modelMatrix, new Matrix3())

      // 归一化每个列向量以移除 scale
      const col0 = new Cartesian3(rotationWithScale[0], rotationWithScale[1], rotationWithScale[2])
      const col1 = new Cartesian3(rotationWithScale[3], rotationWithScale[4], rotationWithScale[5])
      const col2 = new Cartesian3(rotationWithScale[6], rotationWithScale[7], rotationWithScale[8])

      Cartesian3.normalize(col0, col0)
      Cartesian3.normalize(col1, col1)
      Cartesian3.normalize(col2, col2)

      const pureRotation = new Matrix3(
        col0.x, col1.x, col2.x,
        col0.y, col1.y, col2.y,
        col0.z, col1.z, col2.z
      )

      const gizmoMatrix = Matrix4.fromRotationTranslation(pureRotation, position, new Matrix4())
      Matrix4.clone(gizmoMatrix, this.modelMatrix)
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

    // 更新包围盒（如果有变化）
    this._updateBoundingBoxes()
  }

  /**
   * 重置包围盒缓存
   * 应在切换挂载对象时调用
   */
  private _resetBoundingBoxCache() {
    this._cachedModelBounds = null
    this._lastBoundingBoxUpdateMatrix = null
    this._clearBoundingBoxes()
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
      _entityLocator: buildEntityLocator(entity),
    }

    this._mountedPrimitive = virtualPrimitive as unknown as Primitive
    Matrix4.clone(transform, this.modelMatrix)
    this.autoSyncMountedPrimitive = true
    this._lastSyncedPosition = position.clone()

    // 重置包围盒缓存
    this._resetBoundingBoxCache()

    // 挂载完成后刷新显示状态
    if (this.mode) {
      this.setMode(this.mode)
    }
  }

  /**
   * 挂载到 Primitive（如 Model）
   * @param primitive - 要挂载的 primitive（必须有 modelMatrix 属性）
   * @param viewer - Viewer 实例
   */
  mountToPrimitive(primitive: any, viewer?: Viewer | null) {
    if (!primitive || !primitive.modelMatrix) {
      console.error('Primitive must have modelMatrix') // Primitive 必须具有 modelMatrix 属性
      return
    }

    const currentViewer = viewer || this._viewer
    if (!currentViewer) {
      console.error('Viewer is required') // 必须提供 Viewer
      return
    }

    this._mountedPrimitive = primitive
    this.autoSyncMountedPrimitive = true

    // 从 primitive.modelMatrix 中提取位置和纯旋转，移除缩放分量以避免 Gizmo 变形
    const position = Matrix4.getTranslation(primitive.modelMatrix, new Cartesian3())
    const rotationWithScale = Matrix4.getMatrix3(primitive.modelMatrix, new Matrix3())

    // 归一化每个列向量以移除 scale
    const col0 = new Cartesian3(rotationWithScale[0], rotationWithScale[1], rotationWithScale[2])
    const col1 = new Cartesian3(rotationWithScale[3], rotationWithScale[4], rotationWithScale[5])
    const col2 = new Cartesian3(rotationWithScale[6], rotationWithScale[7], rotationWithScale[8])

    Cartesian3.normalize(col0, col0)
    Cartesian3.normalize(col1, col1)
    Cartesian3.normalize(col2, col2)

    const pureRotation = new Matrix3(
      col0.x, col1.x, col2.x,
      col0.y, col1.y, col2.y,
      col0.z, col1.z, col2.z
    )

    // 构建不含缩放的 Gizmo 矩阵
    const gizmoMatrix = Matrix4.fromRotationTranslation(pureRotation, position, new Matrix4())
    Matrix4.clone(gizmoMatrix, this.modelMatrix)

    // 重置包围盒缓存
    this._resetBoundingBoxCache()

    // 挂载完成后刷新显示状态
    if (this.mode) {
      this.setMode(this.mode)
    }
  }

  /**
   * 挂载到 Model 的子节点（ModelNode）
   *
   * 使用 Cesium 内部的 sceneGraph 流程计算节点世界坐标
   * 完整公式：worldMatrix = modelMatrix × components.transform × axisCorrectionMatrix × transformToRoot × transform
   *
   * 参考：
   * - ModelSceneGraph.js: computedModelMatrix 的计算
   * - ModelRuntimeNode.js: computedTransform 的定义
   * - ModelUtility.js: getAxisCorrectionMatrix
   *
   * @param node - ModelNode 对象
   * @param model - 节点所属的 Model 对象
   * @param viewer - Viewer 实例
   */
  mountToNode(node: any, model: any, viewer?: Viewer | null) {
    if (!node) {
      console.error('Node is required') // 必须提供 Node
      return
    }

    if (!model || !model.modelMatrix) {
      console.error('Model must have modelMatrix property') // Model 必须具有 modelMatrix 属性
      return
    }

    const currentViewer = viewer || this._viewer
    if (!currentViewer) {
      console.error('Viewer is required') // 必须提供 Viewer
      return
    }

    // 获取节点的 runtimeNode
    // 支持两种输入类型：
    // 1. ModelNode（通过 model.getNode() 获取）: 需要通过 node._runtimeNode 访问
    // 2. ModelRuntimeNode（通过 picked.detail.node 获取）: 它本身就是 runtimeNode
    let runtimeNode: any
    if (node._runtimeNode) {
      // 传入的是 ModelNode
      runtimeNode = node._runtimeNode
    } else if (node.transform !== undefined || node.transformToRoot !== undefined) {
      // 传入的是 ModelRuntimeNode（直接来自 picked.detail.node）
      runtimeNode = node
    } else {
      console.error('Cannot access runtime node information') // 无法访问运行时节点信息
      return
    }

    // 获取模型的 sceneGraph
    const sceneGraph = (model as any)._sceneGraph
    if (!sceneGraph) {
      console.error('Cannot access _sceneGraph') // 无法访问 _sceneGraph
      return
    }

    // 1. 获取各种变换矩阵
    // 1.1 节点的局部变换（相对于父节点）
    const nodeTransform = runtimeNode.transform || Matrix4.IDENTITY

    // 1.2 到根节点的累积变换
    const transformToRoot = runtimeNode.transformToRoot || Matrix4.IDENTITY

    // 1.3 轴校正矩阵 - 尝试从 sceneGraph 获取，否则手动计算
    let axisCorrectionMatrix: Matrix4
    if (sceneGraph.axisCorrectionMatrix) {
      axisCorrectionMatrix = sceneGraph.axisCorrectionMatrix
    } else {
      // 从 components 获取 upAxis 和 forwardAxis
      const components = sceneGraph.components
      const Axis = (CesiumInternal as any).Axis
      const upAxis = components?.upAxis ?? Axis.Y  // 默认 Y-up (glTF 标准)
      const forwardAxis = components?.forwardAxis ?? Axis.X  // 默认 X-forward
      axisCorrectionMatrix = (CesiumInternal as any).ModelUtility.getAxisCorrectionMatrix(upAxis, forwardAxis)
    }

    // 1.4 组件变换（模型级别）
    const componentsTransform = sceneGraph.components?.transform || Matrix4.IDENTITY

    // 1.5 模型矩阵（世界空间位置和方向）
    const modelMatrix = model.modelMatrix

    // 1.6 模型缩放
    const modelScale = (model as any).scale ?? 1

    // 2. 按照公式计算世界矩阵
    // 2. 按照公式计算世界矩阵 (用于位置和物理旋转)
    // worldMatrix = modelMatrix × components.transform × axisCorrectionMatrix × transformToRoot × transform

    // Step 1: transformToRoot × transform
    const step1 = Matrix4.multiply(transformToRoot, nodeTransform, new Matrix4())

    // Step 2: axisCorrectionMatrix × step1
    const step2 = Matrix4.multiply(axisCorrectionMatrix, step1, new Matrix4())

    // Step 3: components.transform × step2
    const step3 = Matrix4.multiply(componentsTransform, step2, new Matrix4())
    
    // Step 4: 应用 scale（如果有）
    let step4: Matrix4
    if (modelScale !== 1) {
      const scaleMatrix = Matrix4.fromUniformScale(modelScale)
      step4 = Matrix4.multiply(scaleMatrix, step3, new Matrix4())
    } else {
      step4 = step3
    }

    // Step 5: modelMatrix × step4 = 最终世界矩阵 (物理正确，包含 axisCorrection)
    const nodeWorldMatrix = Matrix4.multiply(modelMatrix, step4, new Matrix4())

    // 获取节点世界位置
    const nodeWorldPosition = Matrix4.getTranslation(nodeWorldMatrix, new Cartesian3())
    
    // --- 计算 Gizmo 旋转（Local 模式） ---
    // 目标：
    // 1. 初始状态下（节点未被用户操作），Gizmo 轴与整体模型一致
    // 2. 用户通过 Gizmo 旋转节点后，Gizmo 轴反映用户的操作
    
    // 1. 获取 glTF 中节点的原始变换
    const gltf = this._getGltfJson(model)
    let originalNodeTransform = Matrix4.IDENTITY
    if (gltf && gltf.nodes) {
      const nodeName = node.name || node._name
      for (let i = 0; i < gltf.nodes.length; i++) {
        if (gltf.nodes[i].name === nodeName) {
          const gltfNode = gltf.nodes[i]
          if (gltfNode.matrix) {
            originalNodeTransform = Matrix4.fromArray(gltfNode.matrix)
          } else {
            const translation = gltfNode.translation
              ? new Cartesian3(gltfNode.translation[0], gltfNode.translation[1], gltfNode.translation[2])
              : Cartesian3.ZERO
            const rotation = gltfNode.rotation
              ? new (CesiumInternal as any).Quaternion(gltfNode.rotation[0], gltfNode.rotation[1], gltfNode.rotation[2], gltfNode.rotation[3])
              : (CesiumInternal as any).Quaternion.IDENTITY
            const scale = gltfNode.scale
              ? new Cartesian3(gltfNode.scale[0], gltfNode.scale[1], gltfNode.scale[2])
              : new Cartesian3(1, 1, 1)
            originalNodeTransform = Matrix4.fromTranslationQuaternionRotationScale(translation, rotation, scale)
          }
          break
        }
      }
    }
    
    // 2. 计算用户在节点局部空间中的累积旋转
    // userLocalTransform = currentTransform × inverse(originalTransform)
    const originalTransformInverse = Matrix4.inverse(originalNodeTransform, new Matrix4())
    const userLocalTransform = Matrix4.multiply(nodeTransform, originalTransformInverse, new Matrix4())
    
    // 提取用户局部旋转的纯旋转部分（去除缩放）
    const userLocalRotationWithScale = Matrix4.getMatrix3(userLocalTransform, new Matrix3())
    const uCol0 = new Cartesian3(userLocalRotationWithScale[0], userLocalRotationWithScale[1], userLocalRotationWithScale[2])
    const uCol1 = new Cartesian3(userLocalRotationWithScale[3], userLocalRotationWithScale[4], userLocalRotationWithScale[5])
    const uCol2 = new Cartesian3(userLocalRotationWithScale[6], userLocalRotationWithScale[7], userLocalRotationWithScale[8])
    Cartesian3.normalize(uCol0, uCol0)
    Cartesian3.normalize(uCol1, uCol1)
    Cartesian3.normalize(uCol2, uCol2)
    const userLocalRotationPure = new Matrix3(
        uCol0.x, uCol1.x, uCol2.x,
        uCol0.y, uCol1.y, uCol2.y,
        uCol0.z, uCol1.z, uCol2.z
    )
    
    // 3. 将用户局部旋转转换到模型空间
    // 转换矩阵：localToModel = axisCorrectionMatrix × transformToRoot (纯旋转部分)
    const localToModelMatrix = Matrix4.multiply(axisCorrectionMatrix, transformToRoot, new Matrix4())
    const localToModelRotationWithScale = Matrix4.getMatrix3(localToModelMatrix, new Matrix3())
    const lCol0 = new Cartesian3(localToModelRotationWithScale[0], localToModelRotationWithScale[1], localToModelRotationWithScale[2])
    const lCol1 = new Cartesian3(localToModelRotationWithScale[3], localToModelRotationWithScale[4], localToModelRotationWithScale[5])
    const lCol2 = new Cartesian3(localToModelRotationWithScale[6], localToModelRotationWithScale[7], localToModelRotationWithScale[8])
    Cartesian3.normalize(lCol0, lCol0)
    Cartesian3.normalize(lCol1, lCol1)
    Cartesian3.normalize(lCol2, lCol2)
    const localToModelRotation = new Matrix3(
        lCol0.x, lCol1.x, lCol2.x,
        lCol0.y, lCol1.y, lCol2.y,
        lCol0.z, lCol1.z, lCol2.z
    )
    const modelToLocalRotation = Matrix3.inverse(localToModelRotation, new Matrix3())
    
    // userModelRotation = localToModel × userLocalRotation × modelToLocal
    const step1Rotation = Matrix3.multiply(localToModelRotation, userLocalRotationPure, new Matrix3())
    const userModelRotation = Matrix3.multiply(step1Rotation, modelToLocalRotation, new Matrix3())
    
    // 4. 获取 model.modelMatrix 的纯旋转部分
    const modelRotationWithScale = Matrix4.getMatrix3(model.modelMatrix, new Matrix3())
    const mCol0 = new Cartesian3(modelRotationWithScale[0], modelRotationWithScale[1], modelRotationWithScale[2])
    const mCol1 = new Cartesian3(modelRotationWithScale[3], modelRotationWithScale[4], modelRotationWithScale[5])
    const mCol2 = new Cartesian3(modelRotationWithScale[6], modelRotationWithScale[7], modelRotationWithScale[8])
    Cartesian3.normalize(mCol0, mCol0)
    Cartesian3.normalize(mCol1, mCol1)
    Cartesian3.normalize(mCol2, mCol2)
    const modelRotationPure = new Matrix3(
        mCol0.x, mCol1.x, mCol2.x,
        mCol0.y, mCol1.y, mCol2.y,
        mCol0.z, mCol1.z, mCol2.z
    )
    
    // 5. 计算 gizmo 旋转 = modelRotation × userModelRotation
    // 初始状态下 userModelRotation = IDENTITY，所以 gizmo 与整体模型一致
    // 用户操作后，gizmo 反映用户的累积旋转
    const gizmoRotation = Matrix3.multiply(modelRotationPure, userModelRotation, new Matrix3())
    
    // 6. 构建 Gizmo Matrix
    const gizmoMatrix = Matrix4.fromRotationTranslation(
      gizmoRotation,
      nodeWorldPosition,
      new Matrix4()
    )
    
    // 7. 计算 visualOffset（用于 computeNodeGizmoMatrix 更新）
    // visualOffset = inverse(物理旋转) × gizmo旋转
    // 从 nodeWorldMatrix 提取物理旋转
    const physRotationMatrix = Matrix4.getMatrix3(nodeWorldMatrix, new Matrix3())
    const pCol0 = new Cartesian3(physRotationMatrix[0], physRotationMatrix[1], physRotationMatrix[2])
    const pCol1 = new Cartesian3(physRotationMatrix[3], physRotationMatrix[4], physRotationMatrix[5])
    const pCol2 = new Cartesian3(physRotationMatrix[6], physRotationMatrix[7], physRotationMatrix[8])
    Cartesian3.normalize(pCol0, pCol0)
    Cartesian3.normalize(pCol1, pCol1)
    Cartesian3.normalize(pCol2, pCol2)
    const physRotationPure = new Matrix3(
        pCol0.x, pCol1.x, pCol2.x,
        pCol0.y, pCol1.y, pCol2.y,
        pCol0.z, pCol1.z, pCol2.z
    )
    const physMatrixPure = Matrix4.fromRotationTranslation(physRotationPure, Cartesian3.ZERO, new Matrix4())
    const gizmoMatrixPure = Matrix4.fromRotationTranslation(gizmoRotation, Cartesian3.ZERO, new Matrix4())
    const inversePhys = Matrix4.inverse(physMatrixPure, new Matrix4())
    const visualOffset = Matrix4.multiply(inversePhys, gizmoMatrixPure, new Matrix4())

    // 创建包装对象
    const nodeWrapper = {
      modelMatrix: gizmoMatrix,
      _isNode: true,
      _node: node,
      _model: model,
      _axisCorrectionMatrix: axisCorrectionMatrix,
      _sceneGraph: sceneGraph,
      _scale: 1,
      _visualOffset: visualOffset,
    }

    // 挂载
    this._mountedPrimitive = nodeWrapper as any
    Matrix4.clone(gizmoMatrix, this.modelMatrix)
    this.autoSyncMountedPrimitive = false

    // 重置包围盒缓存
    this._resetBoundingBoxCache()

    // 挂载完成后刷新显示状态
    if (this.mode) {
      this.setMode(this.mode)
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
    this.coordinateMode = CoordinateMode.local
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

    // 清除包围盒
    this._clearBoundingBoxes()

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
    if (!this._transPrimitives || !this._rotatePrimitives || !this._scalePrimitives)
      return

    // 先隐藏所有模式的 primitives
    this._transPrimitives._show = false
    this._rotatePrimitives._show = false
    this._scalePrimitives._show = false

    // 更新当前模式
    this.mode = mode

    // 如果没有挂载对象，则保持所有 primitives 隐藏状态
    // 这样可以避免在点击空白区域后调用 setMode 导致 gizmo 意外显示
    if (!this._mountedPrimitive) {
      return
    }

    // 根据模式显示对应的 primitives
    if (mode === GizmoMode.translate) {
      this._transPrimitives._show = true
    }
    else if (mode === GizmoMode.rotate) {
      this._rotatePrimitives._show = true
    }
    else if (mode === GizmoMode.scale) {
      this._scalePrimitives._show = true
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

    // 先隐藏所有辅助线
    for (let i = 0; i < currentPrimitives._helper.length; i++) {
      currentPrimitives._helper[i].show = false
    }

    // 支持传入数组格式的轴 ID
    const axisIds = Array.isArray(axisId) ? axisId : [axisId]

    for (const id of axisIds) {
      // 显示特定的辅助线
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
        return found
      }
    }

    return mounted._entity
  }

  // === 包围盒相关方法 ===

  /**
   * 获取模型的 glTF JSON 数据
   */
  private _getGltfJson(model: any): any {
    let gltf = model._gltf
    if (!gltf && model.loader && model.loader._gltfJsonLoader) gltf = model.loader._gltfJsonLoader._gltf
    if (!gltf && model._loader && model._loader._gltfJsonLoader) gltf = model._loader._gltfJsonLoader._gltf
    if (!gltf && model.loader) gltf = model.loader._gltfJson
    if (!gltf && model._loader) gltf = model._loader._gltfJson
    if (!gltf && model._sceneGraph) gltf = model._sceneGraph._components?.gltfJson || model._sceneGraph._gltfJson
    return gltf
  }

  /**
   * 从 glTF 模型计算模型空间边界
   * 遍历所有节点和 mesh，从 accessor 的 min/max 获取精确边界
   * 应用完整变换链：components.transform × axisCorrectionMatrix × nodeTransform
   * @param model - Cesium Model 对象
   * @returns { min, max } 或 null（模型空间边界，需要用 modelMatrix 变换到世界空间）
   */
  private _getModelBounds(model: any): { min: Cartesian3, max: Cartesian3 } | null {
    try {
      const gltf = this._getGltfJson(model)
      if (!gltf || !gltf.nodes) {
        console.warn('无法获取 glTF 数据')
        return null
      }

      // 获取 sceneGraph 以读取 axisCorrectionMatrix 和 components.transform
      const sceneGraph = model._sceneGraph
      let axisCorrectionMatrix = Matrix4.IDENTITY
      let componentsTransform = Matrix4.IDENTITY

      if (sceneGraph) {
        // 获取轴校正矩阵
        if (sceneGraph.axisCorrectionMatrix) {
          axisCorrectionMatrix = sceneGraph.axisCorrectionMatrix
        }
        else if (sceneGraph.components) {
          const components = sceneGraph.components
          const Axis = (CesiumInternal as any).Axis
          const upAxis = components?.upAxis ?? Axis.Y
          const forwardAxis = components?.forwardAxis ?? Axis.X
          axisCorrectionMatrix = (CesiumInternal as any).ModelUtility.getAxisCorrectionMatrix(upAxis, forwardAxis)
        }

        // 获取组件变换
        if (sceneGraph.components?.transform) {
          componentsTransform = sceneGraph.components.transform
        }
      }

      // 获取模型缩放
      const modelScale = model.scale ?? 1

      let globalMin = new Cartesian3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE)
      let globalMax = new Cartesian3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE)
      let foundAny = false

      // 递归遍历节点
      const traverseNodes = (nodeIndex: number, parentMatrix: Matrix4) => {
        const node = gltf.nodes[nodeIndex]

        // 计算当前节点的局部矩阵
        // 优先使用运行时节点的 transform（反映用户交互后的变换），如果获取不到再回退到 glTF 静态变换
        let localMatrix = Matrix4.clone(Matrix4.IDENTITY, new Matrix4())
        let useRuntimeTransform = false

        // 尝试获取运行时节点的变换
        if (node.name && model.getNode) {
          try {
            const runtimeNode = model.getNode(node.name)
            if (runtimeNode) {
              // 获取运行时节点的 transform（包含用户交互后的变换）
              const runtimeNodeInternal = runtimeNode._runtimeNode || runtimeNode
              if (runtimeNodeInternal?.transform) {
                localMatrix = Matrix4.clone(runtimeNodeInternal.transform, new Matrix4())
                useRuntimeTransform = true
              }
            }
          }
          catch {
            // 如果获取运行时节点失败，使用 glTF 静态变换
          }
        }

        // 如果没有获取到运行时变换，回退到 glTF 静态变换
        if (!useRuntimeTransform) {
          if (node.matrix) {
            localMatrix = Matrix4.fromArray(node.matrix)
          }
          else {
            const translation = node.translation
              ? new Cartesian3(node.translation[0], node.translation[1], node.translation[2])
              : Cartesian3.ZERO
            const rotation = node.rotation
              ? new (CesiumInternal as any).Quaternion(node.rotation[0], node.rotation[1], node.rotation[2], node.rotation[3])
              : (CesiumInternal as any).Quaternion.IDENTITY
            const scale = node.scale
              ? new Cartesian3(node.scale[0], node.scale[1], node.scale[2])
              : new Cartesian3(1, 1, 1)

            localMatrix = Matrix4.fromTranslationQuaternionRotationScale(translation, rotation, scale)
          }
        }

        // 使用运行时变换时，transform 已经包含了完整的父节点链变换（transformToRoot 的效果）
        // 所以不需要再乘以 parentMatrix
        let nodeGlobalMatrix: Matrix4
        if (useRuntimeTransform) {
          // 运行时 transform 是相对于节点自身的局部变换，仍需乘以父级
          // 但是如果父级也使用了运行时变换，就会有重复，需要特殊处理
          // 简化方案：运行时变换的节点使用 transformToRoot 直接得到相对于模型根的完整变换
          const runtimeNode = model.getNode(node.name)
          const runtimeNodeInternal = runtimeNode?._runtimeNode || runtimeNode
          if (runtimeNodeInternal?.transformToRoot) {
            // 使用 transformToRoot × transform 得到节点在模型空间的完整变换
            nodeGlobalMatrix = Matrix4.multiply(
              runtimeNodeInternal.transformToRoot,
              runtimeNodeInternal.transform,
              new Matrix4()
            )
          }
          else {
            // 如果没有 transformToRoot，仍然用 parentMatrix
            nodeGlobalMatrix = Matrix4.multiply(parentMatrix, localMatrix, new Matrix4())
          }
        }
        else {
          // 组合父级矩阵：parentMatrix × localMatrix
          nodeGlobalMatrix = Matrix4.multiply(parentMatrix, localMatrix, new Matrix4())
        }

        // 处理该节点下的 Mesh
        if (node.mesh !== undefined) {
          const mesh = gltf.meshes[node.mesh]
          if (mesh.primitives) {
            for (const primitive of mesh.primitives) {
              const attr = primitive.attributes
              if (attr.POSITION !== undefined) {
                const accessor = gltf.accessors[attr.POSITION]
                if (accessor.min && accessor.max) {
                  // 原始包围盒的 8 个顶点
                  const aMin = accessor.min
                  const aMax = accessor.max
                  const corners = [
                    new Cartesian3(aMin[0], aMin[1], aMin[2]),
                    new Cartesian3(aMin[0], aMin[1], aMax[2]),
                    new Cartesian3(aMin[0], aMax[1], aMin[2]),
                    new Cartesian3(aMin[0], aMax[1], aMax[2]),
                    new Cartesian3(aMax[0], aMin[1], aMin[2]),
                    new Cartesian3(aMax[0], aMin[1], aMax[2]),
                    new Cartesian3(aMax[0], aMax[1], aMin[2]),
                    new Cartesian3(aMax[0], aMax[1], aMax[2]),
                  ]

                  // 完整变换：components.transform × axisCorrectionMatrix × nodeGlobalMatrix × pt
                  // Step 1: axisCorrectionMatrix × nodeGlobalMatrix
                  const step1 = Matrix4.multiply(axisCorrectionMatrix, nodeGlobalMatrix, new Matrix4())
                  // Step 2: componentsTransform × step1
                  const step2 = Matrix4.multiply(componentsTransform, step1, new Matrix4())
                  // Step 3: 应用 model.scale
                  let finalTransform: Matrix4
                  if (modelScale !== 1) {
                    const scaleMatrix = Matrix4.fromUniformScale(modelScale)
                    finalTransform = Matrix4.multiply(scaleMatrix, step2, new Matrix4())
                  }
                  else {
                    finalTransform = step2
                  }

                  // 将这 8 个顶点变换到模型空间
                  for (const pt of corners) {
                    const transformedPt = Matrix4.multiplyByPoint(finalTransform, pt, new Cartesian3())
                    globalMin.x = Math.min(globalMin.x, transformedPt.x)
                    globalMin.y = Math.min(globalMin.y, transformedPt.y)
                    globalMin.z = Math.min(globalMin.z, transformedPt.z)
                    globalMax.x = Math.max(globalMax.x, transformedPt.x)
                    globalMax.y = Math.max(globalMax.y, transformedPt.y)
                    globalMax.z = Math.max(globalMax.z, transformedPt.z)
                  }
                  foundAny = true
                }
              }
            }
          }
        }

        // 递归子节点
        if (node.children) {
          for (const childIndex of node.children) {
            traverseNodes(childIndex, nodeGlobalMatrix)
          }
        }
      }

      // 从场景根节点开始遍历
      const scene = gltf.scenes ? gltf.scenes[gltf.scene || 0] : null
      if (scene && scene.nodes) {
        for (const nodeIndex of scene.nodes) {
          traverseNodes(nodeIndex, Matrix4.IDENTITY)
        }
      }
      else if (gltf.nodes) {
        for (let i = 0; i < gltf.nodes.length; i++) {
          traverseNodes(i, Matrix4.IDENTITY)
        }
      }

      if (!foundAny) return null
      return { min: globalMin, max: globalMax }
    }
    catch (e) {
      console.warn('Failed to get model bounds:', e)
    }
    return null
  }

  /**
   * 从子节点计算边界（只包含该节点的 mesh 原始边界）
   * 注意：返回的是节点 mesh 的原始边界（不做任何变换），
   * 因为渲染时会使用 mounted.modelMatrix 进行完整世界变换
   * @param node - ModelNode 对象
   * @param model - 节点所属的 Model
   * @returns { min, max } 或 null
   */
  private _getNodeBounds(node: any, model: any): { min: Cartesian3, max: Cartesian3 } | null {
    try {
      const gltf = this._getGltfJson(model)
      if (!gltf || !gltf.nodes) {
        return this._getModelBounds(model)
      }

      // 尝试通过节点名称找到对应的 glTF 节点索引
      // 支持 ModelNode（.name）和 ModelRuntimeNode（._name）
      const nodeName = node.name || node._name
      let nodeIndex = -1
      for (let i = 0; i < gltf.nodes.length; i++) {
        if (gltf.nodes[i].name === nodeName) {
          nodeIndex = i
          break
        }
      }

      if (nodeIndex === -1 || gltf.nodes[nodeIndex].mesh === undefined) {
        return this._getModelBounds(model)
      }

      const gltfNode = gltf.nodes[nodeIndex]
      const mesh = gltf.meshes[gltfNode.mesh]
      if (!mesh || !mesh.primitives) {
        return this._getModelBounds(model)
      }

      let nodeMin = new Cartesian3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE)
      let nodeMax = new Cartesian3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE)
      let foundAny = false

      // 只读取原始 accessor 边界，不做任何变换
      // mounted.modelMatrix 会在渲染时进行完整世界变换
      for (const primitive of mesh.primitives) {
        const attr = primitive.attributes
        if (attr.POSITION !== undefined) {
          const accessor = gltf.accessors[attr.POSITION]
          if (accessor.min && accessor.max) {
            const aMin = accessor.min
            const aMax = accessor.max

            // 直接使用原始边界角点
            nodeMin.x = Math.min(nodeMin.x, aMin[0])
            nodeMin.y = Math.min(nodeMin.y, aMin[1])
            nodeMin.z = Math.min(nodeMin.z, aMin[2])
            nodeMax.x = Math.max(nodeMax.x, aMax[0])
            nodeMax.y = Math.max(nodeMax.y, aMax[1])
            nodeMax.z = Math.max(nodeMax.z, aMax[2])
            foundAny = true
          }
        }
      }

      if (!foundAny) {
        return this._getModelBounds(model)
      }

      return { min: nodeMin, max: nodeMax }
    }
    catch (e) {
      console.warn('Failed to get node bounds:', e)
      return this._getModelBounds(model)
    }
  }

  /**
   * 创建 LocalBounds Primitive（模型空间边界，跟随旋转）
   */
  private _createLocalBoundsPrimitive(bounds: { min: Cartesian3, max: Cartesian3 }, modelMatrix: Matrix4): Primitive {
    const aabb = new AxisAlignedBoundingBox(bounds.min, bounds.max)
    const geometry = BoxOutlineGeometry.fromAxisAlignedBoundingBox(aabb)

    const instance = new GeometryInstance({
      geometry,
      modelMatrix: Matrix4.IDENTITY, // 使用 Identity，变换由 Primitive 控制
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(this._localBoundsColor.withAlpha(0.99)),
      },
    })

    return new Primitive({
      geometryInstances: instance,
      appearance: new PerInstanceColorAppearance({
        flat: true,
        translucent: true,
        renderState: {
          depthTest: { enabled: false },
          depthMask: false,
          blending: BlendingState.ALPHA_BLEND,
        },
      }),
      modelMatrix, // 将变换应用在 Primitive 上
      asynchronous: false,
    })
  }

  /**
   * 创建 WorldAABB Primitive（世界空间边界，轴对齐）
   */
  private _createWorldAABBPrimitive(bounds: { min: Cartesian3, max: Cartesian3 }, modelMatrix: Matrix4): Primitive {
    // 先变换8个角点到世界坐标，再计算世界空间的 AABB
    const corners = [
      new Cartesian3(bounds.min.x, bounds.min.y, bounds.min.z),
      new Cartesian3(bounds.max.x, bounds.min.y, bounds.min.z),
      new Cartesian3(bounds.min.x, bounds.max.y, bounds.min.z),
      new Cartesian3(bounds.max.x, bounds.max.y, bounds.min.z),
      new Cartesian3(bounds.min.x, bounds.min.y, bounds.max.z),
      new Cartesian3(bounds.max.x, bounds.min.y, bounds.max.z),
      new Cartesian3(bounds.min.x, bounds.max.y, bounds.max.z),
      new Cartesian3(bounds.max.x, bounds.max.y, bounds.max.z),
    ]

    const worldCorners = corners.map(c => Matrix4.multiplyByPoint(modelMatrix, c, new Cartesian3()))
    const worldAABB = AxisAlignedBoundingBox.fromPoints(worldCorners)

    const geometry = BoxOutlineGeometry.fromAxisAlignedBoundingBox(worldAABB)

    const instance = new GeometryInstance({
      geometry,
      modelMatrix: Matrix4.IDENTITY, // 已经是世界坐标
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(this._worldAABBColor.withAlpha(0.99)),
      },
    })

    return new Primitive({
      geometryInstances: instance,
      appearance: new PerInstanceColorAppearance({
        flat: true,
        translucent: true,
        renderState: {
          depthTest: { enabled: false },
          depthMask: false,
          blending: BlendingState.ALPHA_BLEND,
        },
      }),
      asynchronous: false,
    })
  }

  /**
   * 更新并渲染包围盒（内部方法）
   * 根据 _showLocalBounds 和 _showWorldAABB 开关决定渲染内容
   */
  _updateBoundingBoxes(): void {
    if (!this._viewer || !this._mountedPrimitive) {
      return
    }

    // 如果都不显示，直接返回，并清理现有包围盒
    if (!this._showLocalBounds && !this._showWorldAABB) {
      // console.log('BoundingBoxOpt: Not showing any bounds')
      this._clearBoundingBoxes()
      return
    }
    
    // 如果已有缓存的 Bounds，直接使用避免重复解析 glTF
    let bounds = this._cachedModelBounds
    // console.log('BoundingBoxOpt: Update called. Cached bounds:', !!bounds)
    
    const mounted = this._mountedPrimitive as MountedVirtualPrimitive
    let modelMatrix: Matrix4

    if (mounted._isNode && mounted._node && mounted._model) {
      // 子节点：获取原始边界并使用完整的物理世界矩阵
      if (!bounds) {
        bounds = this._getNodeBounds(mounted._node, mounted._model)
      }

      // 使用完整公式计算物理世界矩阵：
      // worldMatrix = modelMatrix × components.transform × axisCorrectionMatrix × transformToRoot × transform
      const node = mounted._node
      const model = mounted._model
      // 支持两种情况：
      // 1. node 是 ModelNode（有 _runtimeNode 属性）
      // 2. node 是 ModelRuntimeNode（本身就是 runtimeNode，有 transform/transformToRoot 属性）
      const runtimeNode = node._runtimeNode || (node.transform !== undefined || node.transformToRoot !== undefined ? node : null)
      const sceneGraph = model._sceneGraph

      const nodeTransform = runtimeNode?.transform || node.matrix || Matrix4.IDENTITY
      const transformToRoot = runtimeNode?.transformToRoot || Matrix4.IDENTITY

      // 获取轴校正矩阵
      let axisCorrectionMatrix = Matrix4.IDENTITY
      if (sceneGraph?.axisCorrectionMatrix) {
        axisCorrectionMatrix = sceneGraph.axisCorrectionMatrix
      }
      else if (sceneGraph?.components) {
        const components = sceneGraph.components
        const Axis = (CesiumInternal as any).Axis
        const upAxis = components?.upAxis ?? Axis.Y
        const forwardAxis = components?.forwardAxis ?? Axis.X
        axisCorrectionMatrix = (CesiumInternal as any).ModelUtility.getAxisCorrectionMatrix(upAxis, forwardAxis)
      }

      const componentsTransform = sceneGraph?.components?.transform || Matrix4.IDENTITY
      const modelScale = model.scale ?? 1

      // Step 1: transformToRoot × transform
      const step1 = Matrix4.multiply(transformToRoot, nodeTransform, new Matrix4())
      // Step 2: axisCorrectionMatrix × step1
      const step2 = Matrix4.multiply(axisCorrectionMatrix, step1, new Matrix4())
      // Step 3: components.transform × step2
      const step3 = Matrix4.multiply(componentsTransform, step2, new Matrix4())
      // Step 4: 应用 scale
      let step4: Matrix4
      if (modelScale !== 1) {
        const scaleMatrix = Matrix4.fromUniformScale(modelScale)
        step4 = Matrix4.multiply(scaleMatrix, step3, new Matrix4())
      }
      else {
        step4 = step3
      }
      // Step 5: modelMatrix × step4 = 最终世界矩阵
      modelMatrix = Matrix4.multiply(model.modelMatrix, step4, new Matrix4())
    }
    else if (mounted._isEntity) {
      // Entity 类型暂不支持包围盒（需要知道实际的几何体）
      return
    }
    else {
      // 普通 Model
      const model = this._mountedPrimitive as any
      if (!bounds) {
        bounds = this._getModelBounds(model)
      }
      modelMatrix = model.modelMatrix
    }

    if (!bounds) {
      return
    }

    // 缓存当前边界数据
    this._currentBounds = bounds
    this._cachedModelBounds = bounds

    // --- 优化：检查是否需要更新 ---
    // 只有当矩阵发生明显变化，或者 Primitive 尚未创建时，才需要销毁重建 WorldAABB
    // 对于 LocalBounds，只需要创建一次，后续只需更新 matrix（除非切换挂载对象）

    const matrixEquals = this._lastBoundingBoxUpdateMatrix
      && Matrix4.equalsEpsilon(this._lastBoundingBoxUpdateMatrix, modelMatrix, CesiumMath.EPSILON5)

    if (matrixEquals && this._localBoundsPrimitive && this._worldAABBPrimitive) {
        // 如果矩阵未变且图元都已就绪，则无需任何操作
        return
    }
    
    // 如果只显示 LocalBounds 且已存在，且矩阵未变，也直接返回（LocalBounds 更新在下面，但如果矩阵未变其实也不用更新，不过Cesium的update可能需要）
    // 为了稳妥，只要矩阵变了就继续。如果矩阵没变，检查需要的图元是否都存在。
    const needLocal = this._showLocalBounds
    const needWorld = this._showWorldAABB
    const hasLocal = !!this._localBoundsPrimitive
    const hasWorld = !!this._worldAABBPrimitive
    
    if (matrixEquals) {
        if ((!needLocal || hasLocal) && (!needWorld || hasWorld)) {
            return
        }
    }

    // 记录本次更新的矩阵
    if (!this._lastBoundingBoxUpdateMatrix) {
        this._lastBoundingBoxUpdateMatrix = new Matrix4()
    }
    Matrix4.clone(modelMatrix, this._lastBoundingBoxUpdateMatrix)


    // 1. 处理 LocalBounds (OBB) - 随物体旋转
    if (this._showLocalBounds) {
      if (!this._localBoundsPrimitive) {
        // 首次创建
        // console.log('BoundingBoxOpt: Creating LocalBoundsPrimitive', bounds, modelMatrix)
        this._localBoundsPrimitive = this._createLocalBoundsPrimitive(bounds, modelMatrix)
        // 确保矩阵被设置 (防止构造函数参数未生效)
        this._localBoundsPrimitive.modelMatrix = Matrix4.clone(modelMatrix, new Matrix4())
        this._viewer.scene.primitives.add(this._localBoundsPrimitive)
      } else {
        // 已存在，仅更新位置矩阵 (Primitive.modelMatrix 是可写的)
        // 注意：LocalBounds 是 GeometryInstance，更新 Primitive.modelMatrix 会生效
        // console.log('BoundingBoxOpt: Updating LocalBoundsPrimitive matrix')
        this._localBoundsPrimitive.modelMatrix = modelMatrix
      }
    } else {
      // 如果关闭显示，销毁现有实例
      if (this._localBoundsPrimitive) {
         this._viewer.scene.primitives.remove(this._localBoundsPrimitive)
         this._localBoundsPrimitive = null
      }
    }


    // 2. 处理 WorldAABB (AABB) - 始终轴对齐
    // 对于 AABB，因为其形状随旋转改变（Geometry 顶点改变），无法简单通过 modelMatrix 更新
    // 必须重建 Geometry，或者使用动态更新 Geometry 的高级方法。
    // 这里为了简单和正确，保持重建策略，但利用 matrixEquals 避免静止时的重建。

    if (this._showWorldAABB) {
      if (!matrixEquals || !this._worldAABBPrimitive) {
         // 需要重建 (位置变了，或者首次创建)
         if (this._worldAABBPrimitive) {
           this._viewer.scene.primitives.remove(this._worldAABBPrimitive)
         }
         this._worldAABBPrimitive = this._createWorldAABBPrimitive(bounds, modelMatrix)
         this._viewer.scene.primitives.add(this._worldAABBPrimitive)
      }
      // 如果 matrixEquals && _worldAABBPrimitive 存在，则什么都不用做 (Primitive 保持原样)
    } else {
      // 如果关闭显示，销毁现有实例
      if (this._worldAABBPrimitive) {
        this._viewer.scene.primitives.remove(this._worldAABBPrimitive)
        this._worldAABBPrimitive = null
      }
    }
  }

  /**
   * 清除所有包围盒 Primitive
   */
  _clearBoundingBoxes(): void {
    if (this._viewer) {
      if (this._localBoundsPrimitive) {
        this._viewer.scene.primitives.remove(this._localBoundsPrimitive)
        this._localBoundsPrimitive = null
      }
      if (this._worldAABBPrimitive) {
        this._viewer.scene.primitives.remove(this._worldAABBPrimitive)
        this._worldAABBPrimitive = null
      }
    }
    this._currentBounds = null
  }

  /**
   * 设置 LocalBounds 显示状态
   */
  setShowLocalBounds(show: boolean): void {
    this._showLocalBounds = show
    this._updateBoundingBoxes()
  }

  /**
   * 设置 WorldAABB 显示状态
   */
  setShowWorldAABB(show: boolean): void {
    this._showWorldAABB = show
    this._updateBoundingBoxes()
  }

  /**
   * 获取当前边界数据（只读）
   */
  get currentBounds(): { min: Cartesian3, max: Cartesian3 } | null {
    return this._currentBounds
  }

  /**
   * 设置 Gizmo 的启用/禁用状态
   * @param enabled - true 启用交互, false 禁用交互（仍然可见但不响应鼠标事件）
   */
  setEnabled(enabled: boolean) {
    this._enabled = enabled
  }

  /**
   * 获取 Gizmo 的启用状态
   * @returns 当前是否启用
   */
  get enabled(): boolean {
    return this._enabled
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
