import type { ScreenSpaceEventHandler as SSEHandler, Viewer } from 'cesium'
import type { Gizmo, MountedEntityLocator } from './Gizmo'
import { BoundingSphere, Cartesian2, Cartesian3, Cartographic, Math as CesiumMath, ConstantPositionProperty, defined, Matrix3, Matrix4, SceneTransforms, ScreenSpaceEventHandler, ScreenSpaceEventType, Transforms } from 'cesium'
import { GizmoMode, GizmoPart, TranslateMode } from './Gizmo'

// 虚拟 Primitive 接口，用于 Entity 适配
interface VirtualPrimitive {
  modelMatrix: Matrix4
  _isEntity: boolean
  _entity: any
  _entityLocator?: MountedEntityLocator
}

/**
 * 构建实体定位器（通用实现）
 */
function buildEntityLocator(entity: any): MountedEntityLocator | undefined {
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
    if (!key.startsWith('_') && typeof entity[key] !== 'function' && key !== 'id') {
      const value = entity[key]
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

export function computeCircle(r: number) {
  const points = []
  for (let i = 0; i <= 360; i++) {
    const radians = CesiumMath.toRadians(i)
    const x = Math.cos(radians) * r
    const y = Math.sin(radians) * r
    points.push(new Cartesian3(x, y, 0.0))
  }

  return points
}

let startPos = new Cartesian2() // For Trans and Rotate
let gizmoStartPos = new Cartesian3()
let gizmoStartModelMatrix = new Matrix4()
let mountedPrimitiveStartModelMatrix = new Matrix4() // For Scale
let pickedGizmoId: GizmoPart | null = null
let handler: SSEHandler | undefined
// 保存原始相机事件类型配置
let originalTiltEventTypes: any = null
let originalRotateEventTypes: any = null
let originalZoomEventTypes: any = null

const scratchTransMatrix = new Matrix4()
const scratchRotateScale = new Cartesian3()
const scratchRotateMatrix = new Matrix4()
const scratchScaleMatrix = new Matrix4()

/**
 *
 * @param {Viewer} viewer
 * @param {Gizmo} gizmo
 */
export function addPointerEventHandler(viewer: Viewer, gizmo: Gizmo) {
  handler = new ScreenSpaceEventHandler(viewer.canvas)

  handler.setInputAction((movement: SSEHandler.PositionedEvent) => {
    const picked = viewer.scene.pick(movement.position)

    if (defined(picked)) {
      if (!gizmo.isGizmoPrimitive(picked.primitive)) {
        // 用于解决其他对象被Gizmo遮挡后无法选中的问题
        if (gizmo._transPrimitives) {
          gizmo._transPrimitives._show = false
        }
        requestAnimationFrame(() => {
          if (gizmo._transPrimitives) {
            gizmo._transPrimitives._show = true
          }
        })

        // 检查是否是Entity
        if (picked.id && picked.id.position) {
          const entity = picked.id
          const position = entity.position.getValue(viewer.clock.currentTime)
          if (position) {
            // 使用Entity的位置创建变换矩阵
            const transform = Transforms.eastNorthUpToFixedFrame(position)

            // 创建一个虚拟的primitive对象来适配gizmo
            const virtualPrimitive: VirtualPrimitive = {
              modelMatrix: transform.clone(),
              _isEntity: true,
              _entity: entity,
              _entityLocator: buildEntityLocator(entity),
            }

            // 设置gizmo的目标
            gizmo._mountedPrimitive = virtualPrimitive as any
            gizmo.modelMatrix = transform.clone()
          }
        }
        // 检查是否是Primitive
        else if (picked.primitive && picked.primitive.modelMatrix instanceof Matrix4) {
          gizmo._mountedPrimitive = picked.primitive
          gizmo.modelMatrix = picked.primitive.modelMatrix.clone()
        }
      }
    }
    else {
      // 点击空白处 隐藏gizmo
      if (gizmo._transPrimitives) {
        gizmo._transPrimitives._show = false
      }
    }
  }, ScreenSpaceEventType.LEFT_CLICK)

  handler.setInputAction((movement: SSEHandler.PositionedEvent) => {
    const picked = viewer.scene.pick(movement.position)
    if (defined(picked)) {
      if (
        picked.id === GizmoPart.xAxis
        || picked.id === GizmoPart.yAxis
        || picked.id === GizmoPart.zAxis
        || picked.id === GizmoPart.xyPlane
        || picked.id === GizmoPart.xzPlane
        || picked.id === GizmoPart.yzPlane
      ) {
        console.log(picked.id)
        // picked gizmo
        pickedGizmoId = picked.id

        // 保存原始相机事件类型配置
        const controller = viewer.scene.screenSpaceCameraController
        originalTiltEventTypes = Array.isArray(controller.tiltEventTypes) ? [...controller.tiltEventTypes] : controller.tiltEventTypes
        originalRotateEventTypes = Array.isArray(controller.rotateEventTypes) ? [...controller.rotateEventTypes] : controller.rotateEventTypes
        originalZoomEventTypes = Array.isArray(controller.zoomEventTypes) ? [...controller.zoomEventTypes] : controller.zoomEventTypes

        // 完全禁用相机控制
        viewer.scene.screenSpaceCameraController.enableRotate = false
        viewer.scene.screenSpaceCameraController.enableTranslate = false
        viewer.scene.screenSpaceCameraController.enableZoom = false
        viewer.scene.screenSpaceCameraController.enableTilt = false
        viewer.scene.screenSpaceCameraController.enableLook = false

        // 清空所有相机事件类型，确保不会响应任何鼠标事件
        controller.tiltEventTypes = []
        controller.rotateEventTypes = []
        controller.zoomEventTypes = []

        startPos = movement.position
        gizmoStartPos = new Cartesian3(
          gizmo.modelMatrix[12],
          gizmo.modelMatrix[13],
          gizmo.modelMatrix[14],
        )
        gizmoStartModelMatrix = gizmo.modelMatrix.clone()
        if (gizmo._mountedPrimitive) {
          mountedPrimitiveStartModelMatrix
            = gizmo._mountedPrimitive.modelMatrix.clone()
        }

        gizmo._isInteracting = true

        if (typeof gizmo.onGizmoPointerDown === 'function') {
          gizmo.onGizmoPointerDown(new PointerEvent('pointerdown'))
        }
      }
      else {
        pickedGizmoId = null
        gizmo._isInteracting = false
        viewer.scene.screenSpaceCameraController.enableRotate = true
        viewer.scene.screenSpaceCameraController.enableTranslate = true
      }
    }
  }, ScreenSpaceEventType.LEFT_DOWN)

  handler.setInputAction((_movement: SSEHandler.PositionedEvent) => {
    if (pickedGizmoId) {
      pickedGizmoId = null
      startPos = new Cartesian2()
      gizmoStartPos = new Cartesian3()
      gizmoStartModelMatrix = new Matrix4()
      mountedPrimitiveStartModelMatrix = new Matrix4()
      gizmo._isInteracting = false

      if (typeof gizmo.onGizmoPointerUp === 'function') {
        gizmo.onGizmoPointerUp(new PointerEvent('pointerup'))
      }
    }

    // 恢复相机控制
    const controller = viewer.scene.screenSpaceCameraController
    viewer.scene.screenSpaceCameraController.enableRotate = true
    viewer.scene.screenSpaceCameraController.enableTranslate = true
    viewer.scene.screenSpaceCameraController.enableZoom = true
    viewer.scene.screenSpaceCameraController.enableTilt = true
    viewer.scene.screenSpaceCameraController.enableLook = true

    // 恢复原始相机事件类型配置
    if (originalTiltEventTypes !== null) {
      controller.tiltEventTypes = originalTiltEventTypes
      originalTiltEventTypes = null
    }
    if (originalRotateEventTypes !== null) {
      controller.rotateEventTypes = originalRotateEventTypes
      originalRotateEventTypes = null
    }
    if (originalZoomEventTypes !== null) {
      controller.zoomEventTypes = originalZoomEventTypes
      originalZoomEventTypes = null
    }
  }, ScreenSpaceEventType.LEFT_UP)

  handler.setInputAction((movement: SSEHandler.MotionEvent) => {
    if (!pickedGizmoId) {
      const hovered = viewer.scene.pick(movement.endPosition)
      const xMaterial
        = defined(hovered) && (hovered.id === GizmoPart.xAxis)
          ? gizmo._highlightMaterial
          : gizmo._xMaterial
      const yMaterial
        = defined(hovered) && (hovered.id === GizmoPart.yAxis)
          ? gizmo._highlightMaterial
          : gizmo._yMaterial
      const zMaterial
        = defined(hovered) && (hovered.id === GizmoPart.zAxis)
          ? gizmo._highlightMaterial
          : gizmo._zMaterial

      // Plane materials
      const xyPlaneMaterial
        = defined(hovered) && hovered.id === GizmoPart.xyPlane
          ? gizmo._planeHighlightMaterial
          : gizmo._xyPlaneMaterial
      const xzPlaneMaterial
        = defined(hovered) && hovered.id === GizmoPart.xzPlane
          ? gizmo._planeHighlightMaterial
          : gizmo._xzPlaneMaterial
      const yzPlaneMaterial
        = defined(hovered) && hovered.id === GizmoPart.yzPlane
          ? gizmo._planeHighlightMaterial
          : gizmo._yzPlaneMaterial

      if (gizmo._transPrimitives) {
        gizmo._transPrimitives._part[0].appearance.material = xMaterial
        gizmo._transPrimitives._part[1].appearance.material = yMaterial
        gizmo._transPrimitives._part[2].appearance.material = zMaterial
        // Plane materials for translate (indices 3, 4, 5)
        if (gizmo._transPrimitives._part.length > 3) {
          gizmo._transPrimitives._part[3].appearance.material = xyPlaneMaterial
          gizmo._transPrimitives._part[4].appearance.material = xzPlaneMaterial
          gizmo._transPrimitives._part[5].appearance.material = yzPlaneMaterial
        }
      }
      // ----
      if (gizmo._rotatePrimitives) {
        gizmo._rotatePrimitives._part[0].appearance.material = xMaterial
        gizmo._rotatePrimitives._part[1].appearance.material = yMaterial
        gizmo._rotatePrimitives._part[2].appearance.material = zMaterial
      }
      // ----
      if (gizmo._scalePrimitives) {
        gizmo._scalePrimitives._part[0].appearance.material = xMaterial
        gizmo._scalePrimitives._part[1].appearance.material = yMaterial
        gizmo._scalePrimitives._part[2].appearance.material = zMaterial
        // Plane materials for scale (indices 3, 4, 5)
        if (gizmo._scalePrimitives._part.length > 3) {
          gizmo._scalePrimitives._part[3].appearance.material = xyPlaneMaterial
          gizmo._scalePrimitives._part[4].appearance.material = xzPlaneMaterial
          gizmo._scalePrimitives._part[5].appearance.material = yzPlaneMaterial
        }
      }

      // Show/hide helper line based on hovered axis or plane
      if (defined(hovered)) {
        if (hovered.id === GizmoPart.xAxis) {
          gizmo.setHelperLineVisible(GizmoPart.xAxis)
        }
        else if (hovered.id === GizmoPart.yAxis) {
          gizmo.setHelperLineVisible(GizmoPart.yAxis)
        }
        else if (hovered.id === GizmoPart.zAxis) {
          gizmo.setHelperLineVisible(GizmoPart.zAxis)
        }
        else if (hovered.id === GizmoPart.xyPlane) {
          // Show both X and Y helper lines for XY plane
          gizmo.setHelperLineVisible([GizmoPart.xAxis, GizmoPart.yAxis])
        }
        else if (hovered.id === GizmoPart.xzPlane) {
          // Show both X and Z helper lines for XZ plane
          gizmo.setHelperLineVisible([GizmoPart.xAxis, GizmoPart.zAxis])
        }
        else if (hovered.id === GizmoPart.yzPlane) {
          // Show both Y and Z helper lines for YZ plane
          gizmo.setHelperLineVisible([GizmoPart.yAxis, GizmoPart.zAxis])
        }
        else {
          gizmo.setHelperLineVisible(null)
        }
      }
      else {
        gizmo.setHelperLineVisible(null)
      }

      return
    }

    const mouseDirOnWindowCoordinates = new Cartesian2(
      movement.endPosition.x - startPos.x,
      movement.endPosition.y - startPos.y,
    )
    if (
      mouseDirOnWindowCoordinates.x === 0
      && mouseDirOnWindowCoordinates.y === 0
    ) {
      return
    }

    // * modelMatrix = transform * rotation * scale
    if (gizmo.mode === GizmoMode.translate) {
      let trans

      // Check if it's a plane operation
      if (pickedGizmoId === GizmoPart.xyPlane
        || pickedGizmoId === GizmoPart.xzPlane
        || pickedGizmoId === GizmoPart.yzPlane) {
        trans = getPlaneTrans(
          pickedGizmoId,
          viewer,
          mouseDirOnWindowCoordinates,
          gizmo,
        )
      }
      else {
        trans = getTrans(
          pickedGizmoId,
          viewer,
          mouseDirOnWindowCoordinates,
          gizmo,
        )
      }

      // Two translation Mode
      if (gizmo.transMode === TranslateMode.local) {
        // Local模式：在物体自身坐标系中移动
        // trans已经是在物体坐标系中的偏移量（通过getTrans计算）
        const transMatrix = Matrix4.fromTranslation(trans, scratchTransMatrix)
        const resultMatrix = Matrix4.multiply(
          transMatrix,
          gizmoStartModelMatrix,
          transMatrix,
        )

        if (
          Number.isNaN(resultMatrix[12])
          || Number.isNaN(resultMatrix[13])
          || Number.isNaN(resultMatrix[14])
        ) {
          return
        }

        // apply translation to gizmo (保持原有旋转)
        const translation = Matrix4.getTranslation(resultMatrix, new Cartesian3())
        const newMatrix = Matrix4.clone(gizmo.modelMatrix, new Matrix4())
        Matrix4.setTranslation(newMatrix, translation, newMatrix)
        gizmo.modelMatrix = newMatrix

        if (typeof gizmo.onGizmoPointerMove === 'function') {
          gizmo.onGizmoPointerMove({
            mode: GizmoMode.translate,
            transMode: TranslateMode.local,
            result: translation,
          } as any)
        }

        if (gizmo.applyTransformationToMountedPrimitive) {
          const mountedPrimitive = gizmo._mountedPrimitive
          if (mountedPrimitive && (mountedPrimitive as any)._isEntity) {
            // 处理Entity的位置更新 - 使用 ConstantPositionProperty
            const entity = (mountedPrimitive as any)._entity
            entity.position = new ConstantPositionProperty(translation.clone())
            // 更新 Gizmo 的最后同步位置

            gizmo._lastSyncedPosition = translation.clone()
          }
          else if (mountedPrimitive) {
            const newPrimitiveMatrix = Matrix4.clone(mountedPrimitive.modelMatrix, new Matrix4())
            Matrix4.setTranslation(newPrimitiveMatrix, translation, newPrimitiveMatrix)
            mountedPrimitive.modelMatrix = newPrimitiveMatrix
          }
        }
      }
      else if (gizmo.transMode === TranslateMode.surface) {
        // Surface模式：在地表ENU坐标系中移动（东-北-上）
        // trans是在ENU坐标系中的偏移量
        const startCartographic = Cartographic.fromCartesian(gizmoStartPos)
        const resultCartographic = new Cartographic()
        const resultPosition = new Cartesian3()

        // 获取ENU坐标系
        const enuMatrix = Transforms.eastNorthUpToFixedFrame(gizmoStartPos)

        // 将偏移量应用到世界坐标
        const worldOffset = Matrix4.multiplyByPointAsVector(enuMatrix, trans, new Cartesian3())
        const newWorldPosition = Cartesian3.add(gizmoStartPos, worldOffset, new Cartesian3())

        // 转换到地理坐标
        Cartographic.fromCartesian(newWorldPosition, undefined, resultCartographic)

        // 根据轴向进行约束
        switch (pickedGizmoId) {
          case GizmoPart.xAxis: {
            // 沿东方向移动：只改变经度，保持纬度和高度
            resultCartographic.latitude = startCartographic.latitude
            resultCartographic.height = startCartographic.height
            break
          }
          case GizmoPart.yAxis: {
            // 沿北方向移动：只改变纬度，保持经度和高度
            resultCartographic.longitude = startCartographic.longitude
            resultCartographic.height = startCartographic.height
            break
          }
          case GizmoPart.zAxis: {
            // 沿高度方向移动：只改变高度，保持经纬度
            resultCartographic.longitude = startCartographic.longitude
            resultCartographic.latitude = startCartographic.latitude
            break
          }
          case GizmoPart.xyPlane: {
            // XY平面：改变经纬度，保持高度
            resultCartographic.height = startCartographic.height
            break
          }
          case GizmoPart.xzPlane: {
            // XZ平面：改变经度和高度，保持纬度
            resultCartographic.latitude = startCartographic.latitude
            break
          }
          case GizmoPart.yzPlane: {
            // YZ平面：改变纬度和高度，保持经度
            resultCartographic.longitude = startCartographic.longitude
            break
          }
        }

        // 转换回笛卡尔坐标
        Cartographic.toCartesian(resultCartographic, undefined, resultPosition)

        // 重新构建ENU坐标系（因为位置改变了，需要新的地表坐标系）
        const oldEnuMatrix = Transforms.eastNorthUpToFixedFrame(gizmoStartPos)
        const oldEnuMatrixInverse = Matrix4.inverseTransformation(oldEnuMatrix, new Matrix4())

        // 获取物体在旧ENU坐标系中的相对变换（去掉位置，只保留旋转）
        const relativeTransform = Matrix4.multiply(
          oldEnuMatrixInverse,
          gizmoStartModelMatrix,
          new Matrix4(),
        )

        // 在新位置构建新的ENU坐标系
        const newEnuMatrix = Transforms.eastNorthUpToFixedFrame(resultPosition)

        // 应用相对变换到新的ENU坐标系
        const resultMatrix = Matrix4.multiply(
          newEnuMatrix,
          relativeTransform,
          new Matrix4(),
        )

        if (
          Number.isNaN(resultMatrix[12])
          || Number.isNaN(resultMatrix[13])
          || Number.isNaN(resultMatrix[14])
        ) {
          return
        }

        // apply translation to gizmo
        Matrix4.clone(resultMatrix, gizmo.modelMatrix)

        if (typeof gizmo.onGizmoPointerMove === 'function') {
          gizmo.onGizmoPointerMove({
            mode: GizmoMode.translate,
            transMode: TranslateMode.surface,
            result: resultMatrix.clone(),
          } as any)
        }

        if (gizmo.applyTransformationToMountedPrimitive) {
          const mountedPrimitive = gizmo._mountedPrimitive
          if (mountedPrimitive && (mountedPrimitive as any)._isEntity) {
            // 处理Entity的位置更新 - 使用 ConstantPositionProperty
            const newPosition = Matrix4.getTranslation(resultMatrix, new Cartesian3())
            const entity = (mountedPrimitive as any)._entity
            entity.position = new ConstantPositionProperty(newPosition)
            // 更新 Gizmo 的最后同步位置
            gizmo._lastSyncedPosition = newPosition.clone()
          }
          else if (mountedPrimitive) {
            Matrix4.clone(resultMatrix, mountedPrimitive.modelMatrix)
          }
        }
      }
    }
    else if (gizmo.mode === GizmoMode.rotate) {
      const rotate = getRotate(
        pickedGizmoId,
        viewer,
        gizmoStartPos,
        gizmoStartModelMatrix,
        movement.startPosition,
        movement.endPosition,
      )

      Matrix4.multiplyByMatrix3(
        gizmoStartModelMatrix,
        rotate,
        gizmoStartModelMatrix,
      )

      // apply rotation to gizmo
      Matrix4.clone(gizmoStartModelMatrix, gizmo.modelMatrix)

      // ----
      const mountedPrimitive = gizmo._mountedPrimitive

      if (!mountedPrimitive) {
        return
      }

      const scale = Matrix4.getScale(
        mountedPrimitive.modelMatrix,
        scratchRotateScale,
      )

      const resultMatrix = Matrix4.multiplyByScale(
        gizmoStartModelMatrix,
        scale,
        scratchRotateMatrix,
      )

      if (typeof gizmo.onGizmoPointerMove === 'function') {
        gizmo.onGizmoPointerMove({
          mode: GizmoMode.rotate,
          result: Transforms.fixedFrameToHeadingPitchRoll(resultMatrix),
        } as any)
      }

      if (gizmo.applyTransformationToMountedPrimitive) {
        if ((mountedPrimitive as any)._isEntity) {
          // Entity 使用 CallbackPositionProperty，不需要手动更新 position
          // onGizmoPointerMove 回调会触发业务层更新

          // 更新 Gizmo 的最后同步位置
          const newPosition = Matrix4.getTranslation(resultMatrix, new Cartesian3())
          gizmo._lastSyncedPosition = newPosition.clone()
        }
        else {
          Matrix4.clone(resultMatrix, mountedPrimitive.modelMatrix)
        }
      }
    }
    else if (gizmo.mode === GizmoMode.scale) {
      let scale

      // Check if it's a plane operation
      if (pickedGizmoId === GizmoPart.xyPlane
        || pickedGizmoId === GizmoPart.xzPlane
        || pickedGizmoId === GizmoPart.yzPlane) {
        scale = getPlaneScale(
          pickedGizmoId,
          viewer,
          gizmoStartPos,
          gizmoStartModelMatrix,
          mouseDirOnWindowCoordinates,
        )
      }
      else {
        scale = getScale(
          pickedGizmoId,
          viewer,
          gizmoStartPos,
          gizmoStartModelMatrix,
          mouseDirOnWindowCoordinates,
        )
      }

      // don't apply scale to gizmo

      if (scale && typeof gizmo.onGizmoPointerMove === 'function') {
        gizmo.onGizmoPointerMove({
          mode: GizmoMode.scale,
          result: Matrix4.fromScale(scale, scratchScaleMatrix),
        } as any)
      }

      if (gizmo.applyTransformationToMountedPrimitive && scale) {
        const mountedPrimitive = gizmo._mountedPrimitive

        if (mountedPrimitive && (mountedPrimitive as any)._isEntity) {
          // 对Entity应用缩放 - 需要保存原始尺寸来正确计算缩放
          const entity = (mountedPrimitive as any)._entity
          if (entity.box && entity.box.dimensions) {
            // 使用相对缩放而不是绝对缩放
            if (!entity._originalDimensions) {
              entity._originalDimensions = entity.box.dimensions.getValue
                ? entity.box.dimensions.getValue(gizmo._viewer?.clock.currentTime)
                : entity.box.dimensions
            }
            const newDimensions = new Cartesian3(
              entity._originalDimensions.x * scale.x,
              entity._originalDimensions.y * scale.y,
              entity._originalDimensions.z * scale.z,
            )
            entity.box.dimensions = newDimensions
          }
        }
        else if (mountedPrimitive) {
          const resultMatrix = Matrix4.multiplyByScale(
            mountedPrimitiveStartModelMatrix,
            scale,
            scratchScaleMatrix,
          )
          Matrix4.clone(resultMatrix, mountedPrimitive.modelMatrix)
        }
      }
    }
  }, ScreenSpaceEventType.MOUSE_MOVE)
}

export function removePointerEventHandler() {
  if (!handler) {
    return
  }
  handler.removeInputAction(ScreenSpaceEventType.LEFT_CLICK)
  handler.removeInputAction(ScreenSpaceEventType.LEFT_DOWN)
  handler.removeInputAction(ScreenSpaceEventType.LEFT_UP)
  handler.removeInputAction(ScreenSpaceEventType.MOUSE_MOVE)
  handler.destroy()
  handler = undefined
}

function getTrans(gizmoPartId: GizmoPart, viewer: Viewer, mouseDirOnWindowCoordinates: Cartesian2, gizmo: Gizmo) {
  let axisDir: Cartesian3
  switch (gizmoPartId) {
    case GizmoPart.xAxis:
      axisDir = Cartesian3.UNIT_X
      break
    case GizmoPart.yAxis:
      axisDir = Cartesian3.UNIT_Y
      break
    case GizmoPart.zAxis:
      axisDir = Cartesian3.UNIT_Z
      break
    default:
      return new Cartesian3()
  }

  // 根据不同的平移模式选择不同的坐标系
  let transform
  if (gizmo && gizmo.transMode === TranslateMode.local) {
    // Local模式：使用物体自身的坐标系
    transform = gizmoStartModelMatrix.clone()
  }
  else {
    // Surface模式：使用地表ENU坐标系
    transform = Transforms.eastNorthUpToFixedFrame(gizmoStartPos)
  }

  const axisDirOnWorldCoordinates = Matrix4.multiplyByPointAsVector(
    transform,
    axisDir,
    new Cartesian3(),
  )

  const originPosOnWindowCoordinates = SceneTransforms.worldToWindowCoordinates(
    viewer.scene,
    gizmoStartPos,
  )

  if (!originPosOnWindowCoordinates) {
    return new Cartesian3()
  }

  const endPos = Cartesian3.add(
    gizmoStartPos,
    axisDirOnWorldCoordinates,
    new Cartesian3(),
  )
  const endPosOnWindowCoordinates = SceneTransforms.worldToWindowCoordinates(
    viewer.scene,
    endPos,
  )

  if (!endPosOnWindowCoordinates) {
    return new Cartesian3()
  }

  const axisDirOnWindowCoordinates = Cartesian2.subtract(
    endPosOnWindowCoordinates,
    originPosOnWindowCoordinates,
    new Cartesian2(),
  )

  // 然后与mouseDir做点积, 得到沿轴移动的像素数
  const deltaPixelsAlongAxis
    = Cartesian2.dot(axisDirOnWindowCoordinates, mouseDirOnWindowCoordinates)
      / Cartesian2.magnitude(axisDirOnWindowCoordinates)

  const metersPerPixel = viewer.camera.getPixelSize(
    new BoundingSphere(
      gizmoStartPos,
      Cartesian3.magnitude(axisDirOnWorldCoordinates),
    ),
    viewer.canvas.width,
    viewer.canvas.height,
  )

  // 计算移动距离
  const distance = deltaPixelsAlongAxis * metersPerPixel

  // 根据模式返回不同坐标系的偏移量
  if (gizmo && gizmo.transMode === TranslateMode.surface) {
    // Surface模式：返回ENU局部坐标系的偏移量（不需要转换到世界坐标）
    return Cartesian3.multiplyByScalar(axisDir, distance, new Cartesian3())
  }

  // Local模式：返回世界坐标系的偏移量
  return Cartesian3.multiplyByScalar(
    axisDirOnWorldCoordinates,
    distance,
    new Cartesian3(),
  )
}

function getPlaneTrans(gizmoPartId: GizmoPart, viewer: Viewer, mouseDirOnWindowCoordinates: Cartesian2, gizmo: Gizmo) {
  // 根据不同的平移模式选择不同的坐标系
  let transform
  if (gizmo && gizmo.transMode === TranslateMode.local) {
    // Local模式：使用物体自身的坐标系
    transform = gizmoStartModelMatrix.clone()
  }
  else {
    // Surface模式：使用地表ENU坐标系
    transform = Transforms.eastNorthUpToFixedFrame(gizmoStartPos)
  }

  let axis1Dir: Cartesian3, axis2Dir: Cartesian3
  switch (gizmoPartId) {
    case GizmoPart.xyPlane:
      axis1Dir = Cartesian3.UNIT_X
      axis2Dir = Cartesian3.UNIT_Y
      break
    case GizmoPart.xzPlane:
      axis1Dir = Cartesian3.UNIT_X
      axis2Dir = Cartesian3.UNIT_Z
      break
    case GizmoPart.yzPlane:
      axis1Dir = Cartesian3.UNIT_Y
      axis2Dir = Cartesian3.UNIT_Z
      break
    default:
      return new Cartesian3()
  }

  // Get axis directions in world coordinates
  const axis1DirWorld = Matrix4.multiplyByPointAsVector(
    transform,
    axis1Dir,
    new Cartesian3(),
  )
  const axis2DirWorld = Matrix4.multiplyByPointAsVector(
    transform,
    axis2Dir,
    new Cartesian3(),
  )

  const originPosOnWindowCoordinates = SceneTransforms.worldToWindowCoordinates(
    viewer.scene,
    gizmoStartPos,
  )

  if (!originPosOnWindowCoordinates) {
    return new Cartesian3()
  }

  // Calculate axis1 direction on window
  const axis1EndPos = Cartesian3.add(
    gizmoStartPos,
    axis1DirWorld,
    new Cartesian3(),
  )
  const axis1EndPosOnWindow = SceneTransforms.worldToWindowCoordinates(
    viewer.scene,
    axis1EndPos,
  )
  if (!axis1EndPosOnWindow) {
    return new Cartesian3()
  }

  const axis1DirOnWindow = Cartesian2.subtract(
    axis1EndPosOnWindow,
    originPosOnWindowCoordinates,
    new Cartesian2(),
  )

  // Calculate axis2 direction on window
  const axis2EndPos = Cartesian3.add(
    gizmoStartPos,
    axis2DirWorld,
    new Cartesian3(),
  )
  const axis2EndPosOnWindow = SceneTransforms.worldToWindowCoordinates(
    viewer.scene,
    axis2EndPos,
  )
  if (!axis2EndPosOnWindow) {
    return new Cartesian3()
  }

  const axis2DirOnWindow = Cartesian2.subtract(
    axis2EndPosOnWindow,
    originPosOnWindowCoordinates,
    new Cartesian2(),
  )

  // Project mouse movement onto both axes
  const deltaPixelsAxis1
    = Cartesian2.dot(axis1DirOnWindow, mouseDirOnWindowCoordinates)
      / Cartesian2.magnitude(axis1DirOnWindow)
  const deltaPixelsAxis2
    = Cartesian2.dot(axis2DirOnWindow, mouseDirOnWindowCoordinates)
      / Cartesian2.magnitude(axis2DirOnWindow)

  const metersPerPixel = viewer.camera.getPixelSize(
    new BoundingSphere(
      gizmoStartPos,
      Cartesian3.magnitude(axis1DirWorld),
    ),
    viewer.canvas.width,
    viewer.canvas.height,
  )

  // Calculate movement in both axes
  const distance1 = deltaPixelsAxis1 * metersPerPixel
  const distance2 = deltaPixelsAxis2 * metersPerPixel

  // 根据模式返回不同坐标系的偏移量
  if (gizmo && gizmo.transMode === TranslateMode.surface) {
    // Surface模式：返回ENU局部坐标系的偏移量
    const movement1 = Cartesian3.multiplyByScalar(axis1Dir, distance1, new Cartesian3())
    const movement2 = Cartesian3.multiplyByScalar(axis2Dir, distance2, new Cartesian3())
    return Cartesian3.add(movement1, movement2, new Cartesian3())
  }

  // Local模式：返回世界坐标系的偏移量
  const movement1 = Cartesian3.multiplyByScalar(axis1DirWorld, distance1, new Cartesian3())
  const movement2 = Cartesian3.multiplyByScalar(axis2DirWorld, distance2, new Cartesian3())
  return Cartesian3.add(movement1, movement2, new Cartesian3())
}

function getRotate(
  gizmoPartId: GizmoPart,
  viewer: Viewer,
  gizmoStartPos: Cartesian3,
  gizmoStartModelMatrix: Matrix4,
  mouseStartPosOnWindowCoordinates: Cartesian2,
  mouseEndPosOnWindowCoordinates: Cartesian2,
) {
  // cal delta angle between start and end around origin
  const originPosOnWindowCoordinates = SceneTransforms.worldToWindowCoordinates(
    viewer.scene,
    gizmoStartPos,
  )

  if (!originPosOnWindowCoordinates) {
    return new Matrix3()
  }

  const startDirOnWindowCoordinates = Cartesian2.subtract(
    mouseStartPosOnWindowCoordinates,
    originPosOnWindowCoordinates,
    new Cartesian2(),
  )

  const endDirOnWindowCoordinates = Cartesian2.subtract(
    mouseEndPosOnWindowCoordinates,
    originPosOnWindowCoordinates,
    new Cartesian2(),
  )

  const cross = CesiumMath.signNotZero(
    Cartesian2.cross(startDirOnWindowCoordinates, endDirOnWindowCoordinates),
  )

  const angle = Cartesian2.angleBetween(
    startDirOnWindowCoordinates,
    endDirOnWindowCoordinates,
  )

  const isClockwise = -cross

  const rayFromCameraToGizmoPos = Cartesian3.subtract(
    viewer.scene.camera.positionWC,
    gizmoStartPos,
    new Cartesian3(),
  )

  let isCameraOnPositiveSide
  const rotation = new Matrix3()
  const axisDir = new Cartesian3()
  switch (gizmoPartId) {
    case GizmoPart.xAxis:
      Matrix4.multiplyByPointAsVector(
        gizmoStartModelMatrix,
        Cartesian3.UNIT_X,
        axisDir,
      )
      isCameraOnPositiveSide = CesiumMath.signNotZero(
        Cartesian3.dot(axisDir, rayFromCameraToGizmoPos),
      )
      Matrix3.fromRotationX(
        angle * isClockwise * isCameraOnPositiveSide,
        rotation,
      )
      break
    case GizmoPart.yAxis:
      Matrix4.multiplyByPointAsVector(
        gizmoStartModelMatrix,
        Cartesian3.UNIT_Y,
        axisDir,
      )
      isCameraOnPositiveSide = CesiumMath.signNotZero(
        Cartesian3.dot(axisDir, rayFromCameraToGizmoPos),
      )
      Matrix3.fromRotationY(
        angle * isClockwise * isCameraOnPositiveSide,
        rotation,
      )
      break
    case GizmoPart.zAxis:
      Matrix4.multiplyByPointAsVector(
        gizmoStartModelMatrix,
        Cartesian3.UNIT_Z,
        axisDir,
      )
      isCameraOnPositiveSide = CesiumMath.signNotZero(
        Cartesian3.dot(axisDir, rayFromCameraToGizmoPos),
      )
      Matrix3.fromRotationZ(
        angle * isClockwise * isCameraOnPositiveSide,
        rotation,
      )
      break
  }

  return rotation
}

function getScale(
  gizmoPartId: GizmoPart,
  viewer: Viewer,
  gizmoStartPos: Cartesian3,
  gizmoStartModelMatrix: Matrix4,
  mouseDirOnWindowCoordinates: Cartesian2,
) {
  const axisDirOnWorldCoordinates = new Cartesian3()
  switch (gizmoPartId) {
    case GizmoPart.xAxis:
      Matrix4.multiplyByPointAsVector(
        gizmoStartModelMatrix,
        Cartesian3.UNIT_X,
        axisDirOnWorldCoordinates,
      )
      break

    case GizmoPart.yAxis:
      Matrix4.multiplyByPointAsVector(
        gizmoStartModelMatrix,
        Cartesian3.UNIT_Y,
        axisDirOnWorldCoordinates,
      )
      break
    case GizmoPart.zAxis:
      Matrix4.multiplyByPointAsVector(
        gizmoStartModelMatrix,
        Cartesian3.UNIT_Z,
        axisDirOnWorldCoordinates,
      )
      break
    default:
      return undefined
  }

  const originPosOnWindowCoordinates = SceneTransforms.worldToWindowCoordinates(
    viewer.scene,
    gizmoStartPos,
  )

  if (!originPosOnWindowCoordinates) {
    return undefined
  }

  const endPos = Cartesian3.add(
    gizmoStartPos,
    axisDirOnWorldCoordinates,
    new Cartesian3(),
  )

  const endPosOnWindowCoordinates = SceneTransforms.worldToWindowCoordinates(
    viewer.scene,
    endPos,
  )

  if (!endPosOnWindowCoordinates) {
    return undefined
  }

  const axisDirOnWindowCoordinates = Cartesian2.subtract(
    endPosOnWindowCoordinates,
    originPosOnWindowCoordinates,
    new Cartesian2(),
  )

  // 然后与mouseDir做点积, 得到沿轴移动的像素数
  const deltaPixelsAlongAxis
    = Cartesian2.dot(axisDirOnWindowCoordinates, mouseDirOnWindowCoordinates)
      / Cartesian2.magnitude(axisDirOnWindowCoordinates)
  const factor = deltaPixelsAlongAxis / 10 + 1

  let scale
  switch (gizmoPartId) {
    case GizmoPart.xAxis:
      scale = new Cartesian3(factor, 1, 1)
      break
    case GizmoPart.yAxis:
      scale = new Cartesian3(1, factor, 1)
      break
    case GizmoPart.zAxis:
      scale = new Cartesian3(1, 1, factor)
      break
  }

  return scale
}

function getPlaneScale(
  gizmoPartId: GizmoPart,
  viewer: Viewer,
  gizmoStartPos: Cartesian3,
  gizmoStartModelMatrix: Matrix4,
  mouseDirOnWindowCoordinates: Cartesian2,
) {
  let axis1Dir: Cartesian3, axis2Dir: Cartesian3
  switch (gizmoPartId) {
    case GizmoPart.xyPlane:
      axis1Dir = Cartesian3.UNIT_X
      axis2Dir = Cartesian3.UNIT_Y
      break
    case GizmoPart.xzPlane:
      axis1Dir = Cartesian3.UNIT_X
      axis2Dir = Cartesian3.UNIT_Z
      break
    case GizmoPart.yzPlane:
      axis1Dir = Cartesian3.UNIT_Y
      axis2Dir = Cartesian3.UNIT_Z
      break
    default:
      return undefined
  }

  const axis1DirWorld = new Cartesian3()
  const axis2DirWorld = new Cartesian3()
  Matrix4.multiplyByPointAsVector(
    gizmoStartModelMatrix,
    axis1Dir,
    axis1DirWorld,
  )
  Matrix4.multiplyByPointAsVector(
    gizmoStartModelMatrix,
    axis2Dir,
    axis2DirWorld,
  )

  const originPosOnWindowCoordinates = SceneTransforms.worldToWindowCoordinates(
    viewer.scene,
    gizmoStartPos,
  )

  if (!originPosOnWindowCoordinates) {
    return undefined
  }

  // Calculate average direction for the plane
  const axis1EndPos = Cartesian3.add(
    gizmoStartPos,
    axis1DirWorld,
    new Cartesian3(),
  )
  const axis1EndPosOnWindow = SceneTransforms.worldToWindowCoordinates(
    viewer.scene,
    axis1EndPos,
  )

  if (!axis1EndPosOnWindow) {
    return undefined
  }

  const axis1DirOnWindow = Cartesian2.subtract(
    axis1EndPosOnWindow,
    originPosOnWindowCoordinates,
    new Cartesian2(),
  )

  const axis2EndPos = Cartesian3.add(
    gizmoStartPos,
    axis2DirWorld,
    new Cartesian3(),
  )
  const axis2EndPosOnWindow = SceneTransforms.worldToWindowCoordinates(
    viewer.scene,
    axis2EndPos,
  )

  if (!axis2EndPosOnWindow) {
    return undefined
  }

  const axis2DirOnWindow = Cartesian2.subtract(
    axis2EndPosOnWindow,
    originPosOnWindowCoordinates,
    new Cartesian2(),
  )

  // Average direction for uniform scaling in the plane
  const avgDirOnWindow = Cartesian2.add(
    Cartesian2.normalize(axis1DirOnWindow, new Cartesian2()),
    Cartesian2.normalize(axis2DirOnWindow, new Cartesian2()),
    new Cartesian2(),
  )
  Cartesian2.normalize(avgDirOnWindow, avgDirOnWindow)

  // Project mouse movement onto average direction
  const deltaPixelsAlongPlane = Cartesian2.dot(
    avgDirOnWindow,
    mouseDirOnWindowCoordinates,
  )
  const factor = deltaPixelsAlongPlane / 10 + 1

  let scale
  switch (gizmoPartId) {
    case GizmoPart.xyPlane:
      scale = new Cartesian3(factor, factor, 1)
      break
    case GizmoPart.xzPlane:
      scale = new Cartesian3(factor, 1, factor)
      break
    case GizmoPart.yzPlane:
      scale = new Cartesian3(1, factor, factor)
      break
  }

  return scale
}
