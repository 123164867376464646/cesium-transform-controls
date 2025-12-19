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
 * @param entity - Cesium Entity 对象
 * @returns 实体定位器对象，用于在实体重新创建后重新定位
 */
export function buildEntityLocator(entity: any): MountedEntityLocator | undefined {
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

/**
 * 兼容性处理：世界坐标转屏幕坐标
 * Cesium 1.114+ 使用 SceneTransforms.worldToWindowCoordinates
 * 旧版本使用 SceneTransforms.wgs84ToWindowCoordinates
 */
function worldToWindowCoordinates(scene: any, position: Cartesian3): Cartesian2 | undefined {
  if (SceneTransforms.worldToWindowCoordinates) {
    return SceneTransforms.worldToWindowCoordinates(scene, position)
  }
  // Fallback for older versions
  return (SceneTransforms as any).wgs84ToWindowCoordinates(scene, position)
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
    // 检查 Gizmo 是否启用
    if (!gizmo.enabled)
      return

    const picked = viewer.scene.pick(movement.position)

    if (defined(picked)) {
      if (!gizmo.isGizmoPrimitive(picked.primitive)) {
        // 用于解决其他对象被Gizmo遮挡后无法选中的问题
        // 先隐藏所有模式的 primitive
        if (gizmo._transPrimitives) {
          gizmo._transPrimitives._show = false
        }
        if (gizmo._rotatePrimitives) {
          gizmo._rotatePrimitives._show = false
        }
        if (gizmo._scalePrimitives) {
          gizmo._scalePrimitives._show = false
        }
        requestAnimationFrame(() => {
          // 通过 setMode 只显示当前模式的 primitive
          if (gizmo.mode) {
            gizmo.setMode(gizmo.mode)
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
            // 重新设置当前模式，确保只显示当前模式的 primitive
            if (gizmo.mode) {
              gizmo.setMode(gizmo.mode)
            }
          }
        }
        // 检查是否是Primitive
        else if (picked.primitive && picked.primitive.modelMatrix instanceof Matrix4) {
          gizmo._mountedPrimitive = picked.primitive
          gizmo.modelMatrix = picked.primitive.modelMatrix.clone()
          // 重新设置当前模式，确保只显示当前模式的 primitive
          if (gizmo.mode) {
            gizmo.setMode(gizmo.mode)
          }
        }
      }
    }
    else {
      // 点击空白处 隐藏gizmo（所有模式）
      if (gizmo._transPrimitives) {
        gizmo._transPrimitives._show = false
      }
      if (gizmo._rotatePrimitives) {
        gizmo._rotatePrimitives._show = false
      }
      if (gizmo._scalePrimitives) {
        gizmo._scalePrimitives._show = false
      }
    }
  }, ScreenSpaceEventType.LEFT_CLICK)

  handler.setInputAction((movement: SSEHandler.PositionedEvent) => {
    // 检查 Gizmo 是否启用
    if (!gizmo.enabled)
      return

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
        
        // 统一从 gizmo.modelMatrix 获取起始状态（与 Scale 模式一致）
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
      // 清除缩放操作的起始矩阵
      const mountedPrimitive = gizmo._mountedPrimitive
      if (mountedPrimitive && (mountedPrimitive as any)._nodeStartMatrix) {
        delete (mountedPrimitive as any)._nodeStartMatrix
      }
      // 清除旋转操作的起始矩阵
      if (mountedPrimitive && (mountedPrimitive as any)._nodeRotateStartMatrix) {
        delete (mountedPrimitive as any)._nodeRotateStartMatrix
        delete (mountedPrimitive as any)._gizmoRotateStartMatrix
      }

      // 注意：旋转模式下不同步 gizmo.modelMatrix 的旋转，保持轴方向固定
      // 下次拖动时从 mountedPrimitive.modelMatrix 获取起始状态

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
    // 检查 Gizmo 是否启用
    if (!gizmo.enabled)
      return

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
          else if (mountedPrimitive && (mountedPrimitive as any)._isNode) {
            // 处理节点的变换更新
            const node = (mountedPrimitive as any)._node
            const model = (mountedPrimitive as any)._model
            const runtimeNode = node._runtimeNode
            const sceneGraph = (mountedPrimitive as any)._sceneGraph || model._sceneGraph
            const axisCorrectionMatrix = (mountedPrimitive as any)._axisCorrectionMatrix || Matrix4.IDENTITY

            // 获取当前gizmo的位置
            const currentGizmoTranslation = Matrix4.getTranslation(newMatrix, new Cartesian3())

            // 获取上一帧gizmo的位置（从wrapper的modelMatrix）
            const lastGizmoTranslation = Matrix4.getTranslation(mountedPrimitive.modelMatrix, new Cartesian3())

            // 计算这一帧的位移增量（世界坐标）
            const deltaWorld = Cartesian3.subtract(currentGizmoTranslation, lastGizmoTranslation, new Cartesian3())

            // 使用正确的公式计算节点世界矩阵（与 mountToNode 一致）
            // worldMatrix = modelMatrix × components.transform × axisCorrectionMatrix × transformToRoot × transform
            const modelScale = (model as any).scale ?? 1
            const nodeTransform = runtimeNode?.transform || node.matrix || Matrix4.IDENTITY
            const transformToRoot = runtimeNode?.transformToRoot || Matrix4.IDENTITY
            const componentsTransform = sceneGraph?.components?.transform || Matrix4.IDENTITY

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
            } else {
              step4 = step3
            }
            // Step 5: modelMatrix × step4 = nodeWorldMatrix
            const nodeWorldMatrix = Matrix4.multiply(model.modelMatrix, step4, new Matrix4())

            // 将世界坐标的位移转换到节点自身坐标系
            const inverseNodeWorldMatrix = Matrix4.inverse(nodeWorldMatrix, new Matrix4())
            const deltaInNodeSpace = Matrix4.multiplyByPointAsVector(
              inverseNodeWorldMatrix,
              deltaWorld,
              new Cartesian3()
            )

            // 创建节点坐标系中的平移矩阵，并应用到当前节点矩阵
            const translationMatrix = Matrix4.fromTranslation(deltaInNodeSpace, new Matrix4())
            const newNodeMatrix = Matrix4.multiply(
              nodeTransform,
              translationMatrix,
              new Matrix4()
            )

            // 更新节点矩阵
            node.matrix = newNodeMatrix
            // 如果有 runtimeNode，也需要更新
            if (runtimeNode) {
              runtimeNode.transform = newNodeMatrix
            }

            // 重新计算更新后的节点世界矩阵
            const newTransformToRoot = runtimeNode?.transformToRoot || Matrix4.IDENTITY
            const updatedStep1 = Matrix4.multiply(newTransformToRoot, newNodeMatrix, new Matrix4())
            const updatedStep2 = Matrix4.multiply(axisCorrectionMatrix, updatedStep1, new Matrix4())
            const updatedStep3 = Matrix4.multiply(componentsTransform, updatedStep2, new Matrix4())
            let updatedStep4: Matrix4
            if (modelScale !== 1) {
              const scaleMatrix = Matrix4.fromUniformScale(modelScale)
              updatedStep4 = Matrix4.multiply(scaleMatrix, updatedStep3, new Matrix4())
            } else {
              updatedStep4 = updatedStep3
            }
            const updatedNodeWorldMatrix = Matrix4.multiply(model.modelMatrix, updatedStep4, new Matrix4())

            // 提取位置和旋转（不含scale）更新gizmo显示
            const updatedPosition = Matrix4.getTranslation(updatedNodeWorldMatrix, new Cartesian3())

            // 提取旋转矩阵并归一化以移除scale
            const rotationWithScale = Matrix4.getMatrix3(model.modelMatrix, new Matrix3())

            // 归一化每个列向量以移除scale
            const col0 = new Cartesian3(rotationWithScale[0], rotationWithScale[1], rotationWithScale[2])
            const col1 = new Cartesian3(rotationWithScale[3], rotationWithScale[4], rotationWithScale[5])
            const col2 = new Cartesian3(rotationWithScale[6], rotationWithScale[7], rotationWithScale[8])

            Cartesian3.normalize(col0, col0)
            Cartesian3.normalize(col1, col1)
            Cartesian3.normalize(col2, col2)

            const updatedRotation = new Matrix3(
              col0.x, col1.x, col2.x,
              col0.y, col1.y, col2.y,
              col0.z, col1.z, col2.z
            )

            const updatedGizmoMatrix = Matrix4.fromRotationTranslation(updatedRotation, updatedPosition, new Matrix4())

            // 更新wrapper的modelMatrix（不含scale，gizmo显示用）
            Matrix4.clone(updatedGizmoMatrix, mountedPrimitive.modelMatrix)
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
          else if (mountedPrimitive && (mountedPrimitive as any)._isNode) {
            // 处理节点的变换更新（Surface 模式）
            const node = (mountedPrimitive as any)._node
            const model = (mountedPrimitive as any)._model
            const runtimeNode = node._runtimeNode
            const sceneGraph = (mountedPrimitive as any)._sceneGraph || model._sceneGraph
            const axisCorrectionMatrix = (mountedPrimitive as any)._axisCorrectionMatrix || Matrix4.IDENTITY

            // 获取新 gizmo 位置和旧 gizmo 位置
            const newGizmoPosition = Matrix4.getTranslation(resultMatrix, new Cartesian3())
            const lastGizmoPosition = Matrix4.getTranslation(mountedPrimitive.modelMatrix, new Cartesian3())

            // 计算这一帧的位移增量（世界坐标）
            const deltaWorld = Cartesian3.subtract(newGizmoPosition, lastGizmoPosition, new Cartesian3())

            // 使用正确的公式计算节点世界矩阵（与 mountToNode 一致）
            const modelScale = (model as any).scale ?? 1
            const nodeTransform = runtimeNode?.transform || node.matrix || Matrix4.IDENTITY
            const transformToRoot = runtimeNode?.transformToRoot || Matrix4.IDENTITY
            const componentsTransform = sceneGraph?.components?.transform || Matrix4.IDENTITY

            // 计算当前节点的世界矩阵
            const step1 = Matrix4.multiply(transformToRoot, nodeTransform, new Matrix4())
            const step2 = Matrix4.multiply(axisCorrectionMatrix, step1, new Matrix4())
            const step3 = Matrix4.multiply(componentsTransform, step2, new Matrix4())
            let step4: Matrix4
            if (modelScale !== 1) {
              const scaleMatrix = Matrix4.fromUniformScale(modelScale)
              step4 = Matrix4.multiply(scaleMatrix, step3, new Matrix4())
            } else {
              step4 = step3
            }
            const nodeWorldMatrix = Matrix4.multiply(model.modelMatrix, step4, new Matrix4())

            // 将世界坐标的位移转换到节点自身坐标系
            const inverseNodeWorldMatrix = Matrix4.inverse(nodeWorldMatrix, new Matrix4())
            const deltaInNodeSpace = Matrix4.multiplyByPointAsVector(
              inverseNodeWorldMatrix,
              deltaWorld,
              new Cartesian3()
            )

            // 创建节点坐标系中的平移矩阵，并应用到当前节点矩阵
            const translationMatrix = Matrix4.fromTranslation(deltaInNodeSpace, new Matrix4())
            const newNodeMatrix = Matrix4.multiply(
              nodeTransform,
              translationMatrix,
              new Matrix4()
            )

            // 更新节点矩阵
            node.matrix = newNodeMatrix
            if (runtimeNode) {
              runtimeNode.transform = newNodeMatrix
            }

            // 同时更新 wrapper 的 modelMatrix 以保持同步
            Matrix4.clone(resultMatrix, mountedPrimitive.modelMatrix)
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

      // apply rotation to gizmo TODO 有待商榷
      // Matrix4.clone(gizmoStartModelMatrix, gizmo.modelMatrix)

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
        else if ((mountedPrimitive as any)._isNode) {
          // 处理节点的旋转更新 - 使用与 scale 模式类似的轴映射方法
          const node = (mountedPrimitive as any)._node
          const model = (mountedPrimitive as any)._model
          const runtimeNode = node._runtimeNode
          const sceneGraph = (mountedPrimitive as any)._sceneGraph || model._sceneGraph
          const axisCorrectionMatrix = (mountedPrimitive as any)._axisCorrectionMatrix || Matrix4.IDENTITY

          // 获取节点当前的变换矩阵
          const nodeTransform = runtimeNode?.transform || node.matrix || Matrix4.IDENTITY

          // 保存节点的起始矩阵和起始角度（仅在开始旋转时保存一次）
          if (!(mountedPrimitive as any)._nodeRotateStartMatrix) {
            ;(mountedPrimitive as any)._nodeRotateStartMatrix = nodeTransform.clone()
            ;(mountedPrimitive as any)._rotateAccumulatedAngle = 0
          }
          const nodeStartMatrix = (mountedPrimitive as any)._nodeRotateStartMatrix

          // 使用与 scale 模式相同的方式计算完整的节点世界矩阵
          const modelScale = (model as any).scale ?? 1
          const transformToRoot = runtimeNode?.transformToRoot || Matrix4.IDENTITY
          const componentsTransform = sceneGraph?.components?.transform || Matrix4.IDENTITY

          // 计算 localToModelMatrix
          const step1 = Matrix4.multiply(transformToRoot, nodeStartMatrix, new Matrix4())
          const step2 = Matrix4.multiply(axisCorrectionMatrix, step1, new Matrix4())
          const step3 = Matrix4.multiply(componentsTransform, step2, new Matrix4())
          let localToModelMatrix: Matrix4
          if (modelScale !== 1) {
            const scaleMatrixM = Matrix4.fromUniformScale(modelScale)
            localToModelMatrix = Matrix4.multiply(scaleMatrixM, step3, new Matrix4())
          } else {
            localToModelMatrix = step3
          }

          // 获取从模型空间到节点局部空间的逆矩阵
          const modelToLocalMatrix = Matrix4.inverse(localToModelMatrix, new Matrix4())

          // 将 gizmo 的单位向量转换到节点局部坐标系
          const localXDir = Matrix4.multiplyByPointAsVector(modelToLocalMatrix, Cartesian3.UNIT_X, new Cartesian3())
          const localYDir = Matrix4.multiplyByPointAsVector(modelToLocalMatrix, Cartesian3.UNIT_Y, new Cartesian3())
          const localZDir = Matrix4.multiplyByPointAsVector(modelToLocalMatrix, Cartesian3.UNIT_Z, new Cartesian3())

          // 找出每个 gizmo 轴对应的节点局部轴（X=0, Y=1, Z=2）
          const findMaxAxis = (dir: Cartesian3) => {
            const absX = Math.abs(dir.x)
            const absY = Math.abs(dir.y)
            const absZ = Math.abs(dir.z)
            if (absX >= absY && absX >= absZ) return { axis: 0, sign: Math.sign(dir.x) || 1 }
            if (absY >= absZ) return { axis: 1, sign: Math.sign(dir.y) || 1 }
            return { axis: 2, sign: Math.sign(dir.z) || 1 }
          }

          const xMapping = findMaxAxis(localXDir)
          const yMapping = findMaxAxis(localYDir)
          const zMapping = findMaxAxis(localZDir)

          // 计算坐标变换的行列式来检测手性变化
          // 如果行列式为负，或者轴发生了奇置换（如X↔Y），需要调整旋转方向
          // 构造由 localXDir, localYDir, localZDir 组成的矩阵（列向量）
          const det = localXDir.x * (localYDir.y * localZDir.z - localYDir.z * localZDir.y)
                    - localXDir.y * (localYDir.x * localZDir.z - localYDir.z * localZDir.x)
                    + localXDir.z * (localYDir.x * localZDir.y - localYDir.y * localZDir.x)

          // 检测轴置换的奇偶性
          // 轴映射: [xMapping.axis, yMapping.axis, zMapping.axis] 应该是 [0,1,2] 的某个置换
          // 奇置换需要反转旋转方向
          const permutation = [xMapping.axis, yMapping.axis, zMapping.axis]
          let inversionCount = 0
          for (let i = 0; i < 3; i++) {
            for (let j = i + 1; j < 3; j++) {
              if (permutation[i] > permutation[j]) inversionCount++
            }
          }
          const isOddPermutation = inversionCount % 2 === 1

          // 调试信息 - 打印轴映射
          const axisNames = ['X', 'Y', 'Z']
          console.log('=== 旋转调试信息 ===')
          console.log('拾取的Gizmo轴:', pickedGizmoId === GizmoPart.xAxis ? 'X' : pickedGizmoId === GizmoPart.yAxis ? 'Y' : 'Z')
          console.log('localXDir (gizmo X在节点空间):', `(${localXDir.x.toFixed(4)}, ${localXDir.y.toFixed(4)}, ${localXDir.z.toFixed(4)})`)
          console.log('localYDir (gizmo Y在节点空间):', `(${localYDir.x.toFixed(4)}, ${localYDir.y.toFixed(4)}, ${localYDir.z.toFixed(4)})`)
          console.log('localZDir (gizmo Z在节点空间):', `(${localZDir.x.toFixed(4)}, ${localZDir.y.toFixed(4)}, ${localZDir.z.toFixed(4)})`)
          console.log('轴映射: gizmoX->' + axisNames[xMapping.axis] + '(sign=' + xMapping.sign + ')')
          console.log('轴映射: gizmoY->' + axisNames[yMapping.axis] + '(sign=' + yMapping.sign + ')')
          console.log('轴映射: gizmoZ->' + axisNames[zMapping.axis] + '(sign=' + zMapping.sign + ')')
          console.log('行列式:', det.toFixed(6), ', 置换:', permutation, ', 逆序数:', inversionCount, ', 是奇置换:', isOddPermutation)

          // 根据 pickedGizmoId 确定在节点局部空间中旋转哪个轴
          let localRotationAxis: number
          let axisSign: number
          let gizmoAxisIndex: number // gizmo轴的索引：X=0, Y=1, Z=2
          if (pickedGizmoId === GizmoPart.xAxis) {
            localRotationAxis = xMapping.axis
            axisSign = xMapping.sign
            gizmoAxisIndex = 0
          } else if (pickedGizmoId === GizmoPart.yAxis) {
            localRotationAxis = yMapping.axis
            axisSign = yMapping.sign
            gizmoAxisIndex = 1
          } else if (pickedGizmoId === GizmoPart.zAxis) {
            localRotationAxis = zMapping.axis
            axisSign = zMapping.sign
            gizmoAxisIndex = 2
          } else {
            // 不支持的轴，跳过
            Matrix4.clone(resultMatrix, mountedPrimitive.modelMatrix)
            return
          }

          // 只有当被拾取的轴参与了轴交换时才反转旋转方向
          // 判断标准：gizmo轴索引 != 映射到的节点轴索引，说明发生了交换
          const axisSwapped = gizmoAxisIndex !== localRotationAxis
          if (axisSwapped && isOddPermutation) {
            axisSign = -axisSign
          }

          console.log('选定的局部旋转轴:', axisNames[localRotationAxis], ', 符号(含奇置换修正):', axisSign)

          // 从 rotate（getRotate 返回的旋转矩阵）提取旋转角度
          // getRotate 返回的是 Matrix3，我们需要从中提取角度
          // 由于 rotate 是单轴旋转，可以从矩阵中提取角度
          let angle = 0
          if (pickedGizmoId === GizmoPart.xAxis) {
            // fromRotationX 的矩阵：[1, 0, 0], [0, cos, sin], [0, -sin, cos]
            angle = Math.atan2(rotate[7], rotate[8]) // atan2(sin, cos)
          } else if (pickedGizmoId === GizmoPart.yAxis) {
            // fromRotationY 的矩阵：[cos, 0, -sin], [0, 1, 0], [sin, 0, cos]
            angle = Math.atan2(rotate[2], rotate[0]) // atan2(-(-sin), cos) = atan2(sin at [2], cos at [0])
          } else if (pickedGizmoId === GizmoPart.zAxis) {
            // fromRotationZ 的矩阵：[cos, sin, 0], [-sin, cos, 0], [0, 0, 1]
            angle = Math.atan2(rotate[1], rotate[0]) // atan2(sin, cos)
          }

          console.log('提取的旋转角度(rad):', angle.toFixed(6), ', 度:', (angle * 180 / Math.PI).toFixed(2))

          // 累积角度
          const previousAngle = (mountedPrimitive as any)._rotateAccumulatedAngle
          ;(mountedPrimitive as any)._rotateAccumulatedAngle += angle * axisSign

          console.log('累积角度: 之前=', previousAngle.toFixed(6), ', 增量=', (angle * axisSign).toFixed(6), ', 之后=', (mountedPrimitive as any)._rotateAccumulatedAngle.toFixed(6))

          // 在节点局部空间中创建旋转矩阵
          let localRotation: Matrix3
          const totalAngle = (mountedPrimitive as any)._rotateAccumulatedAngle
          if (localRotationAxis === 0) {
            localRotation = Matrix3.fromRotationX(totalAngle, new Matrix3())
          } else if (localRotationAxis === 1) {
            localRotation = Matrix3.fromRotationY(totalAngle, new Matrix3())
          } else {
            localRotation = Matrix3.fromRotationZ(totalAngle, new Matrix3())
          }

          console.log('应用旋转: 绕节点' + axisNames[localRotationAxis] + '轴旋转', (totalAngle * 180 / Math.PI).toFixed(2), '度')

          // 获取节点起始的旋转、平移和缩放
          const nodeStartRotation = Matrix4.getMatrix3(nodeStartMatrix, new Matrix3())
          const nodeTranslation = Matrix4.getTranslation(nodeStartMatrix, new Cartesian3())
          const nodeScale = Matrix4.getScale(nodeStartMatrix, new Cartesian3())

          console.log('节点起始平移:', `(${nodeTranslation.x.toFixed(4)}, ${nodeTranslation.y.toFixed(4)}, ${nodeTranslation.z.toFixed(4)})`)
          console.log('节点起始缩放:', `(${nodeScale.x.toFixed(4)}, ${nodeScale.y.toFixed(4)}, ${nodeScale.z.toFixed(4)})`)

          // 应用旋转：newRotation = localRotation * startRotation
          const newNodeRotation = Matrix3.multiply(localRotation, nodeStartRotation, new Matrix3())

          // 构建新的节点矩阵（保持原有缩放）
          const newNodeMatrix = Matrix4.fromRotationTranslation(newNodeRotation, nodeTranslation, new Matrix4())
          Matrix4.multiplyByScale(newNodeMatrix, nodeScale, newNodeMatrix)

          // 更新节点矩阵
          node.matrix = newNodeMatrix
          console.log('新节点矩阵已应用')
          console.log('=== 调试信息结束 ===')

          if (runtimeNode) {
            runtimeNode.transform = newNodeMatrix
          }

          // 同时更新 wrapper 的 modelMatrix 以保持同步
          Matrix4.clone(resultMatrix, mountedPrimitive.modelMatrix)
        }
        else {
          Matrix4.clone(resultMatrix, mountedPrimitive.modelMatrix)

          // 更新 Gizmo 的 modelMatrix，但移除缩放分量以避免 Gizmo 变形（与 Scale 模式统一）
          // 提取位置
          const position = Matrix4.getTranslation(resultMatrix, new Cartesian3())
          // 提取旋转矩阵并归一化以移除缩放
          const rotationWithScale = Matrix4.getMatrix3(resultMatrix, new Matrix3())
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
          Matrix4.clone(gizmoMatrix, gizmo.modelMatrix)
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
        else if (mountedPrimitive && (mountedPrimitive as any)._isNode) {
          // 处理节点的缩放更新
          const node = (mountedPrimitive as any)._node
          const model = (mountedPrimitive as any)._model
          const runtimeNode = node._runtimeNode
          const sceneGraph = (mountedPrimitive as any)._sceneGraph || model._sceneGraph
          const axisCorrectionMatrix = (mountedPrimitive as any)._axisCorrectionMatrix || Matrix4.IDENTITY

          // 获取节点的当前变换矩阵
          const nodeTransform = runtimeNode?.transform || node.matrix || Matrix4.IDENTITY

          // 保存起始矩阵供缩放使用（仅在开始缩放时保存一次）
          if (!(mountedPrimitive as any)._nodeStartMatrix) {
            ;(mountedPrimitive as any)._nodeStartMatrix = nodeTransform.clone()
          }
          const nodeStartMatrix = (mountedPrimitive as any)._nodeStartMatrix

          // 使用与 translate 模式相同的方式计算完整的节点世界矩阵
          // worldMatrix = modelMatrix × components.transform × axisCorrectionMatrix × transformToRoot × transform
          const modelScale = (model as any).scale ?? 1
          const transformToRoot = runtimeNode?.transformToRoot || Matrix4.IDENTITY
          const componentsTransform = sceneGraph?.components?.transform || Matrix4.IDENTITY

          // 计算中间变换矩阵（不含 modelMatrix，因为 gizmo 已经在 model 坐标系中）
          const step1 = Matrix4.multiply(transformToRoot, nodeTransform, new Matrix4())
          const step2 = Matrix4.multiply(axisCorrectionMatrix, step1, new Matrix4())
          const step3 = Matrix4.multiply(componentsTransform, step2, new Matrix4())
          let localToModelMatrix: Matrix4
          if (modelScale !== 1) {
            const scaleMatrix = Matrix4.fromUniformScale(modelScale)
            localToModelMatrix = Matrix4.multiply(scaleMatrix, step3, new Matrix4())
          } else {
            localToModelMatrix = step3
          }

          // 获取从模型空间到节点局部空间的逆矩阵
          const modelToLocalMatrix = Matrix4.inverse(localToModelMatrix, new Matrix4())

          // 将 gizmo 的 X/Y/Z 单位向量转换到节点局部坐标系
          // 这告诉我们 gizmo 的每个轴在节点局部坐标系中对应哪个方向
          const localXDir = Matrix4.multiplyByPointAsVector(modelToLocalMatrix, Cartesian3.UNIT_X, new Cartesian3())
          const localYDir = Matrix4.multiplyByPointAsVector(modelToLocalMatrix, Cartesian3.UNIT_Y, new Cartesian3())
          const localZDir = Matrix4.multiplyByPointAsVector(modelToLocalMatrix, Cartesian3.UNIT_Z, new Cartesian3())

          // 找出每个 gizmo 轴对应的节点局部轴（X=0, Y=1, Z=2）
          const findMaxAxis = (dir: Cartesian3) => {
            const absX = Math.abs(dir.x)
            const absY = Math.abs(dir.y)
            const absZ = Math.abs(dir.z)
            if (absX >= absY && absX >= absZ) return 0
            if (absY >= absZ) return 1
            return 2
          }

          const xIdx = findMaxAxis(localXDir)
          const yIdx = findMaxAxis(localYDir)
          const zIdx = findMaxAxis(localZDir)

          // 构建局部缩放向量
          const localScaleArr = [1, 1, 1]
          localScaleArr[xIdx] = scale.x
          localScaleArr[yIdx] = scale.y
          localScaleArr[zIdx] = scale.z

          const localScale = new Cartesian3(localScaleArr[0], localScaleArr[1], localScaleArr[2])

          // 应用缩放到节点的起始矩阵
          const scaledMatrix = Matrix4.multiplyByScale(
            nodeStartMatrix,
            localScale,
            new Matrix4()
          )

          // 更新节点矩阵
          node.matrix = scaledMatrix
          if (runtimeNode) {
            runtimeNode.transform = scaledMatrix
          }
          Matrix4.clone(scaledMatrix, mountedPrimitive.modelMatrix)
        }
        else if (mountedPrimitive) {
          const resultMatrix = Matrix4.multiplyByScale(
            mountedPrimitiveStartModelMatrix,
            scale,
            scratchScaleMatrix,
          )
          Matrix4.clone(resultMatrix, mountedPrimitive.modelMatrix)

          // 更新 Gizmo 的 modelMatrix，但移除缩放分量以避免 Gizmo 变形
          // 提取位置
          const position = Matrix4.getTranslation(resultMatrix, new Cartesian3())
          // 提取旋转矩阵并归一化以移除缩放
          const rotationWithScale = Matrix4.getMatrix3(resultMatrix, new Matrix3())
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
          Matrix4.clone(gizmoMatrix, gizmo.modelMatrix)
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

  const originPosOnWindowCoordinates = worldToWindowCoordinates(
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
  const endPosOnWindowCoordinates = worldToWindowCoordinates(
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

  const originPosOnWindowCoordinates = worldToWindowCoordinates(
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
  const axis1EndPosOnWindow = worldToWindowCoordinates(
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
  const axis2EndPosOnWindow = worldToWindowCoordinates(
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
  const originPosOnWindowCoordinates = worldToWindowCoordinates(
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

  const originPosOnWindowCoordinates = worldToWindowCoordinates(
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

  const endPosOnWindowCoordinates = worldToWindowCoordinates(
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

  const originPosOnWindowCoordinates = worldToWindowCoordinates(
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
  const axis1EndPosOnWindow = worldToWindowCoordinates(
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
  const axis2EndPosOnWindow = worldToWindowCoordinates(
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
