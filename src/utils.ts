import type { ScreenSpaceEventHandler as SSEHandler, Viewer } from 'cesium'
import type { Gizmo, MountedEntityLocator } from './Gizmo'
import { BoundingSphere, Cartesian2, Cartesian3, Cartographic, Math as CesiumMath, ConstantPositionProperty, defined, Matrix3, Matrix4, Quaternion, SceneTransforms, ScreenSpaceEventHandler, ScreenSpaceEventType, Transforms } from 'cesium'
import { GizmoMode, GizmoPart, CoordinateMode } from './Gizmo'

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
 * 旧版本使用 SceneTransforms.wgs84ToWindowCoordinates
 */
function worldToWindowCoordinates(scene: any, position: Cartesian3): Cartesian2 | undefined {
  if (SceneTransforms.worldToWindowCoordinates) {
    return SceneTransforms.worldToWindowCoordinates(scene, position)
  }
  // Fallback for older versions
  return (SceneTransforms as any).wgs84ToWindowCoordinates(scene, position)
}

/**
 * 获取节点的 runtimeNode
 * 支持两种输入类型：
 * 1. ModelNode（通过 model.getNode() 获取）: 需要通过 node._runtimeNode 访问
 * 2. ModelRuntimeNode（通过 picked.detail.node 获取）: 它本身就是 runtimeNode
 * @param node - ModelNode 或 ModelRuntimeNode
 * @returns runtimeNode 对象
 */
function getRuntimeNode(node: any): any {
  if (node._runtimeNode) {
    // 传入的是 ModelNode
    return node._runtimeNode
  } else if (node.transform !== undefined || node.transformToRoot !== undefined) {
    // 传入的是 ModelRuntimeNode（直接来自 picked.detail.node）
    return node
  }
  return null
}

let startPos = new Cartesian2() // 用于平移和旋转
let gizmoStartPos = new Cartesian3()
let gizmoStartModelMatrix = new Matrix4()
let mountedPrimitiveStartModelMatrix = new Matrix4() // 用于缩放
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

// === 用于高频事件处理的复用变量（避免每帧分配新对象） ===
// 位移计算相关
const scratchTranslation = new Cartesian3()
const scratchCurrentGizmoTranslation = new Cartesian3()
const scratchLastGizmoTranslation = new Cartesian3()
const scratchDeltaWorld = new Cartesian3()
const scratchDeltaInNodeSpace = new Cartesian3()
const scratchNewPosition = new Cartesian3()

// 矩阵计算相关
const scratchStep1 = new Matrix4()
const scratchStep2 = new Matrix4()
const scratchStep3 = new Matrix4()
const scratchStep4 = new Matrix4()
const scratchNodeWorldMatrix = new Matrix4()
const scratchInverseNodeWorldMatrix = new Matrix4()
const scratchTranslationMatrix = new Matrix4()
const scratchNewNodeMatrix = new Matrix4()
const scratchStartRotation = new Matrix3()
const scratchStableGizmoMatrix = new Matrix4()
const scratchNewPrimitiveMatrix = new Matrix4()
const scratchUpdatedGizmoMatrix = new Matrix4()

// Surface 模式相关
const scratchResultPosition = new Cartesian3()
const scratchWorldOffset = new Cartesian3()
const scratchNewWorldPosition = new Cartesian3()
const scratchEnuMatrix = new Matrix4()
const scratchOldEnuMatrixInverse = new Matrix4()
const scratchRelativeTransform = new Matrix4()
const scratchNewEnuMatrix = new Matrix4()
const scratchResultMatrix = new Matrix4()
const scratchOriginalScale = new Cartesian3()
const scratchResultWithScale = new Matrix4()
const scratchResultCartographic = new Cartographic()

// 旋转模式相关
const scratchPureRotation = new Matrix3()
const scratchGizmoMatrix = new Matrix4()
const scratchRotationQuaternion = new Quaternion()
const scratchAxisDirection = new Cartesian3()
const scratchCol0 = new Cartesian3()
const scratchCol1 = new Cartesian3()
const scratchCol2 = new Cartesian3()
const scratchPosition = new Cartesian3()
const scratchRotationWithScale = new Matrix3()

// Rotate 模式累积变量
let rotateAccumulatedAngle = 0  // 累积旋转角度
let rotateStartEnuMatrix = new Matrix4()  // Surface 模式起始 ENU 矩阵


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

        // 检查是否点击了模型的子节点 (ModelNode)
        if (picked.detail?.node && picked.primitive?.modelMatrix instanceof Matrix4) {
          const node = picked.detail.node
          const model = picked.primitive
          gizmo.mountToNode(node, model, viewer)
        }
        // 检查是否是Entity
        else if (picked.id && picked.id.position) {
          gizmo.mountToEntity(picked.id, viewer)
        }
        // 检查是否是Primitive（整个模型）
        else if (picked.primitive && picked.primitive.modelMatrix instanceof Matrix4) {
          gizmo.mountToPrimitive(picked.primitive, viewer)
        }
      }
    }
    else {
      // 点击空白处：取消选中并隐藏 gizmo（所有模式）
      // 清除挂载对象，表示没有选中任何物体
      gizmo._mountedPrimitive = null
      gizmo._lastSyncedPosition = null
      if (gizmo._transPrimitives) {
        gizmo._transPrimitives._show = false
      }
      if (gizmo._rotatePrimitives) {
        gizmo._rotatePrimitives._show = false
      }
      if (gizmo._scalePrimitives) {
        gizmo._scalePrimitives._show = false
      }
      // 同时隐藏包围盒（保持与 gizmo 隐藏行为一致）
      if (gizmo._localBoundsPrimitive) {
        gizmo._localBoundsPrimitive.show = false
      }
      if (gizmo._worldAABBPrimitive) {
        gizmo._worldAABBPrimitive.show = false
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
        // 选中 Gizmo
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
        delete (mountedPrimitive as any)._rotateAccumulatedAngle
      }
      // 清除缩放操作的起始矩阵
      if (mountedPrimitive && (mountedPrimitive as any)._nodeStartMatrix) {
        delete (mountedPrimitive as any)._nodeStartMatrix
      }


      pickedGizmoId = null
      startPos = new Cartesian2()
      gizmoStartPos = new Cartesian3()
      gizmoStartModelMatrix = new Matrix4()
      mountedPrimitiveStartModelMatrix = new Matrix4()
      rotateAccumulatedAngle = 0  // 清除 Rotate 累积角度
      rotateStartEnuMatrix = new Matrix4()  // 清除 Rotate ENU 起始矩阵
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

      // 平面材质
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
        // 平移模式的平面材质 (索引 3, 4, 5)
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
        // 缩放模式的平面材质 (索引 3, 4, 5)
        if (gizmo._scalePrimitives._part.length > 3) {
          gizmo._scalePrimitives._part[3].appearance.material = xyPlaneMaterial
          gizmo._scalePrimitives._part[4].appearance.material = xzPlaneMaterial
          gizmo._scalePrimitives._part[5].appearance.material = yzPlaneMaterial
        }
      }

      // 根据悬停的轴或平面显示/隐藏辅助线
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
          // XY 平面显示 X 和 Y 辅助线
          gizmo.setHelperLineVisible([GizmoPart.xAxis, GizmoPart.yAxis])
        }
        else if (hovered.id === GizmoPart.xzPlane) {
          // XZ 平面显示 X 和 Z 辅助线
          gizmo.setHelperLineVisible([GizmoPart.xAxis, GizmoPart.zAxis])
        }
        else if (hovered.id === GizmoPart.yzPlane) {
          // YZ 平面显示 Y 和 Z 辅助线
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

    // * modelMatrix = 平移 * 旋转 * 缩放
    if (gizmo.mode === GizmoMode.translate) {
      let trans

      // 检查是否是平面操作
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

      // 两种平移模式
      if (gizmo.coordinateMode === CoordinateMode.local) {
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

        // 应用平移到 Gizmo (保持原有旋转)
        const translation = Matrix4.getTranslation(resultMatrix, new Cartesian3())
        const newMatrix = Matrix4.clone(gizmo.modelMatrix, new Matrix4())
        Matrix4.setTranslation(newMatrix, translation, newMatrix)
        gizmo.modelMatrix = newMatrix

        if (typeof gizmo.onGizmoPointerMove === 'function') {
          gizmo.onGizmoPointerMove({
            mode: GizmoMode.translate,
            transMode: CoordinateMode.local,
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
            const runtimeNode = getRuntimeNode(node)
            const sceneGraph = (mountedPrimitive as any)._sceneGraph || model._sceneGraph
            const axisCorrectionMatrix = (mountedPrimitive as any)._axisCorrectionMatrix || Matrix4.IDENTITY

            // 获取当前gizmo的位置（使用 scratch 变量）
            Matrix4.getTranslation(newMatrix, scratchCurrentGizmoTranslation)

            // 获取上一帧gizmo的位置（从wrapper的modelMatrix）
            Matrix4.getTranslation(mountedPrimitive.modelMatrix, scratchLastGizmoTranslation)

            // 计算这一帧的位移增量（世界坐标）
            Cartesian3.subtract(scratchCurrentGizmoTranslation, scratchLastGizmoTranslation, scratchDeltaWorld)

            // 使用正确的公式计算节点世界矩阵（与 mountToNode 一致）
            // worldMatrix = modelMatrix × components.transform × axisCorrectionMatrix × transformToRoot × transform
            const modelScale = (model as any).scale ?? 1
            const nodeTransform = runtimeNode?.transform || node.matrix || Matrix4.IDENTITY
            const transformToRoot = runtimeNode?.transformToRoot || Matrix4.IDENTITY
            const componentsTransform = sceneGraph?.components?.transform || Matrix4.IDENTITY

            // Step 1: transformToRoot × transform
            Matrix4.multiply(transformToRoot, nodeTransform, scratchStep1)
            // Step 2: axisCorrectionMatrix × step1
            Matrix4.multiply(axisCorrectionMatrix, scratchStep1, scratchStep2)
            // Step 3: components.transform × step2
            Matrix4.multiply(componentsTransform, scratchStep2, scratchStep3)
            // Step 4: 应用 scale
            if (modelScale !== 1) {
              const scaleMatrix = Matrix4.fromUniformScale(modelScale)
              Matrix4.multiply(scaleMatrix, scratchStep3, scratchStep4)
            } else {
              Matrix4.clone(scratchStep3, scratchStep4)
            }
            // Step 5: modelMatrix × step4 = nodeWorldMatrix
            Matrix4.multiply(model.modelMatrix, scratchStep4, scratchNodeWorldMatrix)

            // 将世界坐标的位移转换到节点自身坐标系
            Matrix4.inverse(scratchNodeWorldMatrix, scratchInverseNodeWorldMatrix)
            Matrix4.multiplyByPointAsVector(
              scratchInverseNodeWorldMatrix,
              scratchDeltaWorld,
              scratchDeltaInNodeSpace
            )

            // 创建节点坐标系中的平移矩阵，并应用到当前节点矩阵
            Matrix4.fromTranslation(scratchDeltaInNodeSpace, scratchTranslationMatrix)
            Matrix4.multiply(
              nodeTransform,
              scratchTranslationMatrix,
              scratchNewNodeMatrix
            )

            // 更新节点矩阵
            node.matrix = Matrix4.clone(scratchNewNodeMatrix)
            // 如果有 runtimeNode，也需要更新
            if (runtimeNode) {
              runtimeNode.transform = Matrix4.clone(scratchNewNodeMatrix)
            }

            // 在 Translate 模式下，gizmo 的旋转应该保持不变（与拖拽开始时一致），只更新位置
            // 这样可以避免轴方向在移动过程中跳变
            computeNodeGizmoMatrix(mountedPrimitive, scratchNewNodeMatrix, scratchUpdatedGizmoMatrix)
            Matrix4.getTranslation(scratchUpdatedGizmoMatrix, scratchNewPosition)
            
            // 从 gizmoStartModelMatrix 获取旋转（保持轴向稳定）
            Matrix4.getMatrix3(gizmoStartModelMatrix, scratchStartRotation)
            Matrix4.fromRotationTranslation(scratchStartRotation, scratchNewPosition, scratchStableGizmoMatrix)

            // 更新wrapper的modelMatrix（不含scale，gizmo显示用）
            Matrix4.clone(scratchStableGizmoMatrix, mountedPrimitive.modelMatrix)
            // 同步更新 gizmo.modelMatrix（GizmoComponentPrimitive 依赖此属性显示轴向）
            Matrix4.clone(scratchStableGizmoMatrix, gizmo.modelMatrix)

          }
          else if (mountedPrimitive) {
            Matrix4.clone(mountedPrimitive.modelMatrix, scratchNewPrimitiveMatrix)
            Matrix4.setTranslation(scratchNewPrimitiveMatrix, translation, scratchNewPrimitiveMatrix)
            mountedPrimitive.modelMatrix = scratchNewPrimitiveMatrix
          }
        }
      }
      else if (gizmo.coordinateMode === CoordinateMode.surface) {
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

        // 应用平移到 Gizmo
        Matrix4.clone(resultMatrix, gizmo.modelMatrix)

        if (typeof gizmo.onGizmoPointerMove === 'function') {
          gizmo.onGizmoPointerMove({
            mode: GizmoMode.translate,
            transMode: CoordinateMode.surface,
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
            const runtimeNode = getRuntimeNode(node)
            const sceneGraph = (mountedPrimitive as any)._sceneGraph || model._sceneGraph
            const axisCorrectionMatrix = (mountedPrimitive as any)._axisCorrectionMatrix || Matrix4.IDENTITY

            // 获取新 gizmo 位置和旧 gizmo 位置（使用 scratch 变量）
            Matrix4.getTranslation(resultMatrix, scratchNewWorldPosition)
            Matrix4.getTranslation(mountedPrimitive.modelMatrix, scratchLastGizmoTranslation)

            // 计算这一帧的位移增量（世界坐标）
            Cartesian3.subtract(scratchNewWorldPosition, scratchLastGizmoTranslation, scratchDeltaWorld)

            // 使用正确的公式计算节点世界矩阵（与 mountToNode 一致）
            const modelScale = (model as any).scale ?? 1
            const nodeTransform = runtimeNode?.transform || node.matrix || Matrix4.IDENTITY
            const transformToRoot = runtimeNode?.transformToRoot || Matrix4.IDENTITY
            const componentsTransform = sceneGraph?.components?.transform || Matrix4.IDENTITY

            // 计算当前节点的世界矩阵
            Matrix4.multiply(transformToRoot, nodeTransform, scratchStep1)
            Matrix4.multiply(axisCorrectionMatrix, scratchStep1, scratchStep2)
            Matrix4.multiply(componentsTransform, scratchStep2, scratchStep3)
            if (modelScale !== 1) {
              const scaleMatrix = Matrix4.fromUniformScale(modelScale)
              Matrix4.multiply(scaleMatrix, scratchStep3, scratchStep4)
            } else {
              Matrix4.clone(scratchStep3, scratchStep4)
            }
            Matrix4.multiply(model.modelMatrix, scratchStep4, scratchNodeWorldMatrix)

            // 将世界坐标的位移转换到节点自身坐标系
            Matrix4.inverse(scratchNodeWorldMatrix, scratchInverseNodeWorldMatrix)
            Matrix4.multiplyByPointAsVector(
              scratchInverseNodeWorldMatrix,
              scratchDeltaWorld,
              scratchDeltaInNodeSpace
            )

            // 创建节点坐标系中的平移矩阵，并应用到当前节点矩阵
            Matrix4.fromTranslation(scratchDeltaInNodeSpace, scratchTranslationMatrix)
            Matrix4.multiply(
              nodeTransform,
              scratchTranslationMatrix,
              scratchNewNodeMatrix
            )

            // 更新节点矩阵
            node.matrix = scratchNewNodeMatrix
            if (runtimeNode) {
              runtimeNode.transform = scratchNewNodeMatrix
            }

            // 同时更新 wrapper 的 modelMatrix 以保持同步
            Matrix4.clone(resultMatrix, mountedPrimitive.modelMatrix)
            // 同步更新 gizmo.modelMatrix（Surface 模式轴向固定 ENU）
            Matrix4.clone(resultMatrix, gizmo.modelMatrix)
          }
          else if (mountedPrimitive) {
            // 保留原始缩放：从原始矩阵获取缩放并应用到新矩阵
            Matrix4.getScale(mountedPrimitiveStartModelMatrix, scratchOriginalScale)
            Matrix4.multiplyByScale(resultMatrix, scratchOriginalScale, scratchResultWithScale)
            Matrix4.clone(scratchResultWithScale, mountedPrimitive.modelMatrix)
          }
        }
      }
    }
    else if (gizmo.mode === GizmoMode.rotate) {
      const mountedPrimitive = gizmo._mountedPrimitive
      if (!mountedPrimitive) {
        return
      }

      // 获取当前 mounted 对象的缩放（用于后续应用）
      const scale = Matrix4.getScale(
        mountedPrimitive.modelMatrix,
        scratchRotateScale,
      )

      // 根据 coordinateMode 决定使用哪个坐标系
      if (gizmo.coordinateMode === CoordinateMode.local) {
        // ========== Local 模式：累积旋转 ==========
        // 使用 gizmoStartModelMatrix 作为参考坐标系（物体自身坐标系）
        const rotate = getRotate(
          pickedGizmoId,
          viewer,
          gizmoStartPos,
          gizmoStartModelMatrix,
          movement.startPosition,
          movement.endPosition,
        )

        // 从 rotate 矩阵提取帧间增量角度
        let frameAngle = 0
        if (pickedGizmoId === GizmoPart.xAxis) {
          frameAngle = Math.atan2(rotate[5], rotate[4])
        } else if (pickedGizmoId === GizmoPart.yAxis) {
          frameAngle = Math.atan2(rotate[6], rotate[8])
        } else if (pickedGizmoId === GizmoPart.zAxis) {
          frameAngle = Math.atan2(rotate[1], rotate[0])
        }

        // 累积角度
        rotateAccumulatedAngle += frameAngle

        // 使用累积角度创建旋转矩阵
        let accumulatedRotation: Matrix3
        if (pickedGizmoId === GizmoPart.xAxis) {
          accumulatedRotation = Matrix3.fromRotationX(rotateAccumulatedAngle, new Matrix3())
        } else if (pickedGizmoId === GizmoPart.yAxis) {
          accumulatedRotation = Matrix3.fromRotationY(rotateAccumulatedAngle, new Matrix3())
        } else {
          accumulatedRotation = Matrix3.fromRotationZ(rotateAccumulatedAngle, new Matrix3())
        }

        // 应用累积旋转到起始矩阵
        const resultMatrix = Matrix4.multiplyByMatrix3(
          gizmoStartModelMatrix,
          accumulatedRotation,
          new Matrix4(),
        )
        Matrix4.multiplyByScale(resultMatrix, scale, resultMatrix)

        if (typeof gizmo.onGizmoPointerMove === 'function') {
          gizmo.onGizmoPointerMove({
            mode: GizmoMode.rotate,
            coordinateMode: CoordinateMode.local,
            result: Transforms.fixedFrameToHeadingPitchRoll(resultMatrix),
          } as any)
        }

        if (gizmo.applyTransformationToMountedPrimitive) {
          if ((mountedPrimitive as any)._isEntity) {
            const newPosition = Matrix4.getTranslation(resultMatrix, new Cartesian3())
            gizmo._lastSyncedPosition = newPosition.clone()
          }
          else if ((mountedPrimitive as any)._isNode) {
            // 子节点处理：使用帧间增量方式
            // 修正：传入 gizmoStartModelMatrix 作为旋转参考系（Local 模式下即为节点初始世界矩阵）
            applyRotateToNode(mountedPrimitive, pickedGizmoId, rotate, resultMatrix, gizmoStartModelMatrix)
            // 同步更新 gizmo.modelMatrix（GizmoComponentPrimitive 依赖此属性显示轴向）
            Matrix4.clone(mountedPrimitive.modelMatrix, gizmo.modelMatrix)
          }

          else {
            // 普通 Primitive：应用累积旋转结果
            Matrix4.clone(resultMatrix, mountedPrimitive.modelMatrix)

            // 更新 Gizmo 的 modelMatrix（移除缩放分量）
            Matrix4.getTranslation(resultMatrix, scratchPosition)
            Matrix4.getMatrix3(resultMatrix, scratchRotationWithScale)
            Cartesian3.fromElements(scratchRotationWithScale[0], scratchRotationWithScale[1], scratchRotationWithScale[2], scratchCol0)
            Cartesian3.fromElements(scratchRotationWithScale[3], scratchRotationWithScale[4], scratchRotationWithScale[5], scratchCol1)
            Cartesian3.fromElements(scratchRotationWithScale[6], scratchRotationWithScale[7], scratchRotationWithScale[8], scratchCol2)
            Cartesian3.normalize(scratchCol0, scratchCol0)
            Cartesian3.normalize(scratchCol1, scratchCol1)
            Cartesian3.normalize(scratchCol2, scratchCol2)
            Matrix3.setColumn(scratchPureRotation, 0, scratchCol0, scratchPureRotation)
            Matrix3.setColumn(scratchPureRotation, 1, scratchCol1, scratchPureRotation)
            Matrix3.setColumn(scratchPureRotation, 2, scratchCol2, scratchPureRotation)
            Matrix4.fromRotationTranslation(scratchPureRotation, scratchPosition, scratchGizmoMatrix)
            Matrix4.clone(scratchGizmoMatrix, gizmo.modelMatrix)

          }
        }
      }
      else {
        // ========== Surface 模式：使用 ENU 坐标系 ==========
        // 初始化 ENU 起始矩阵（仅在开始拖动时）
        if (Matrix4.equals(rotateStartEnuMatrix, Matrix4.IDENTITY) || rotateStartEnuMatrix[0] === 0) {
          rotateStartEnuMatrix = Transforms.eastNorthUpToFixedFrame(gizmoStartPos)
        }

        // 使用 ENU 矩阵作为参考坐标系
        const rotate = getRotate(
          pickedGizmoId,
          viewer,
          gizmoStartPos,
          rotateStartEnuMatrix,
          movement.startPosition,
          movement.endPosition,
        )

        // 从 rotate 矩阵提取帧间增量角度
        let frameAngle = 0
        if (pickedGizmoId === GizmoPart.xAxis) {
          frameAngle = Math.atan2(rotate[5], rotate[4])
        } else if (pickedGizmoId === GizmoPart.yAxis) {
          frameAngle = Math.atan2(rotate[6], rotate[8])
        } else if (pickedGizmoId === GizmoPart.zAxis) {
          frameAngle = Math.atan2(rotate[1], rotate[0])
        }


        // 累积角度
        rotateAccumulatedAngle += frameAngle

        // 使用累积角度在 ENU 坐标系中创建旋转矩阵
        let accumulatedRotation: Matrix3
        if (pickedGizmoId === GizmoPart.xAxis) {
          accumulatedRotation = Matrix3.fromRotationX(rotateAccumulatedAngle, new Matrix3())
        } else if (pickedGizmoId === GizmoPart.yAxis) {
          accumulatedRotation = Matrix3.fromRotationY(rotateAccumulatedAngle, new Matrix3())
        } else {
          accumulatedRotation = Matrix3.fromRotationZ(rotateAccumulatedAngle, new Matrix3())
        }

        // 获取物体在 ENU 坐标系中的相对变换（保持物体原有的局部旋转）
        const enuMatrixInverse = Matrix4.inverseTransformation(rotateStartEnuMatrix, new Matrix4())
        const relativeTransform = Matrix4.multiply(
          enuMatrixInverse,
          gizmoStartModelMatrix,
          new Matrix4(),
        )

        // 应用 ENU 旋转再应用相对变换
        const rotatedEnuMatrix = Matrix4.multiplyByMatrix3(
          rotateStartEnuMatrix,
          accumulatedRotation,
          new Matrix4(),
        )
        const resultMatrix = Matrix4.multiply(
          rotatedEnuMatrix,
          relativeTransform,
          new Matrix4(),
        )
        Matrix4.multiplyByScale(resultMatrix, scale, resultMatrix)

        if (typeof gizmo.onGizmoPointerMove === 'function') {
          gizmo.onGizmoPointerMove({
            mode: GizmoMode.rotate,
            coordinateMode: CoordinateMode.surface,
            result: Transforms.fixedFrameToHeadingPitchRoll(resultMatrix),
          } as any)
        }

        if (gizmo.applyTransformationToMountedPrimitive) {
          if ((mountedPrimitive as any)._isEntity) {
            const newPosition = Matrix4.getTranslation(resultMatrix, new Cartesian3())
            gizmo._lastSyncedPosition = newPosition.clone()
          }
          else if ((mountedPrimitive as any)._isNode) {
            // 子节点 Surface 模式：使用帧间增量方式
            // 修正：传入 rotateStartEnuMatrix 作为旋转参考系
            applyRotateToNodeSurface(mountedPrimitive, pickedGizmoId, rotate, resultMatrix, gizmoStartPos, rotateStartEnuMatrix)
            // 同步更新 gizmo.modelMatrix（GizmoComponentPrimitive 依赖此属性显示轴向）
            Matrix4.clone(mountedPrimitive.modelMatrix, gizmo.modelMatrix)
          }
          else {
            // 普通 Primitive：应用 ENU 旋转结果
            Matrix4.clone(resultMatrix, mountedPrimitive.modelMatrix)

            // 更新 Gizmo 的 modelMatrix（移除缩放分量）
            Matrix4.getTranslation(resultMatrix, scratchPosition)
            Matrix4.getMatrix3(resultMatrix, scratchRotationWithScale)
            Cartesian3.fromElements(scratchRotationWithScale[0], scratchRotationWithScale[1], scratchRotationWithScale[2], scratchCol0)
            Cartesian3.fromElements(scratchRotationWithScale[3], scratchRotationWithScale[4], scratchRotationWithScale[5], scratchCol1)
            Cartesian3.fromElements(scratchRotationWithScale[6], scratchRotationWithScale[7], scratchRotationWithScale[8], scratchCol2)
            Cartesian3.normalize(scratchCol0, scratchCol0)
            Cartesian3.normalize(scratchCol1, scratchCol1)
            Cartesian3.normalize(scratchCol2, scratchCol2)
            Matrix3.setColumn(scratchPureRotation, 0, scratchCol0, scratchPureRotation)
            Matrix3.setColumn(scratchPureRotation, 1, scratchCol1, scratchPureRotation)
            Matrix3.setColumn(scratchPureRotation, 2, scratchCol2, scratchPureRotation)
            Matrix4.fromRotationTranslation(scratchPureRotation, scratchPosition, scratchGizmoMatrix)
            Matrix4.clone(scratchGizmoMatrix, gizmo.modelMatrix)

          }
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

      // 不要对 Gizmo 应用缩放

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
          const runtimeNode = getRuntimeNode(node)
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

          // 计算完整的节点世界矩阵（Node -> World）
          const step1 = Matrix4.multiply(transformToRoot, nodeStartMatrix, new Matrix4())
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

          // 获取从世界空间到节点局部空间的逆矩阵 (World -> Node Local)
          const worldToLocalMatrix = Matrix4.inverse(nodeWorldMatrix, new Matrix4())

          // 将 Gizmo 的 X/Y/Z 轴向量（世界空间）转换到节点局部坐标系
          // Gizmo 的轴向由 gizmoStartModelMatrix 决定
          const gizmoXWorld = Matrix4.multiplyByPointAsVector(gizmoStartModelMatrix, Cartesian3.UNIT_X, new Cartesian3())
          const gizmoYWorld = Matrix4.multiplyByPointAsVector(gizmoStartModelMatrix, Cartesian3.UNIT_Y, new Cartesian3())
          const gizmoZWorld = Matrix4.multiplyByPointAsVector(gizmoStartModelMatrix, Cartesian3.UNIT_Z, new Cartesian3())

          const localXDir = Matrix4.multiplyByPointAsVector(worldToLocalMatrix, gizmoXWorld, new Cartesian3())
          const localYDir = Matrix4.multiplyByPointAsVector(worldToLocalMatrix, gizmoYWorld, new Cartesian3())
          const localZDir = Matrix4.multiplyByPointAsVector(worldToLocalMatrix, gizmoZWorld, new Cartesian3())

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

          // 使用正确计算的 gizmo 世界矩阵（不含 scale）
          const gizmoMatrix = computeNodeGizmoMatrix(mountedPrimitive, scaledMatrix)
          Matrix4.clone(gizmoMatrix, mountedPrimitive.modelMatrix)
          // 同步更新 gizmo.modelMatrix（GizmoComponentPrimitive 依赖此属性显示轴向）
          Matrix4.clone(gizmoMatrix, gizmo.modelMatrix)
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
  if (gizmo && gizmo.coordinateMode === CoordinateMode.local) {
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
  if (gizmo && gizmo.coordinateMode === CoordinateMode.surface) {
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
  if (gizmo && gizmo.coordinateMode === CoordinateMode.local) {
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

  // 获取世界坐标系中的轴方向
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

  // 计算屏幕上的轴1方向
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

  // 计算屏幕上的轴2方向
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

  // 将鼠标移动投影到两个轴上
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

  // 计算两个轴上的移动距离
  const distance1 = deltaPixelsAxis1 * metersPerPixel
  const distance2 = deltaPixelsAxis2 * metersPerPixel

  // 根据模式返回不同坐标系的偏移量
  if (gizmo && gizmo.coordinateMode === CoordinateMode.surface) {
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
  // 计算绕原点从起点到终点的增量角度
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

  // 为了在平面上进行均匀缩放，计算平均方向
  const avgDirOnWindow = Cartesian2.add(
    Cartesian2.normalize(axis1DirOnWindow, new Cartesian2()),
    Cartesian2.normalize(axis2DirOnWindow, new Cartesian2()),
    new Cartesian2(),
  )
  Cartesian2.normalize(avgDirOnWindow, avgDirOnWindow)

  // 将鼠标移动投影到平均方向上
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

/**
 * 计算子节点的 gizmo 世界矩阵（位置 + 旋转，不含 scale）
 * 用于在子节点操作后正确更新 gizmo.modelMatrix
 */
// 用于 computeNodeGizmoMatrix 的本地 scratch 变量
const cngm_scratchStep1 = new Matrix4()
const cngm_scratchStep2 = new Matrix4()
const cngm_scratchStep3 = new Matrix4()
const cngm_scratchStep4 = new Matrix4()
const cngm_scratchNodeWorldMatrix = new Matrix4()
const cngm_scratchPosition = new Cartesian3()
const cngm_scratchRotationWithScale = new Matrix3()
const cngm_scratchCol0 = new Cartesian3()
const cngm_scratchCol1 = new Cartesian3()
const cngm_scratchCol2 = new Cartesian3()
const cngm_scratchPhysRotationPure = new Matrix3()
const cngm_scratchPhysMatrixPure = new Matrix4()
const cngm_scratchVisualMatrixPure = new Matrix4()
const cngm_scratchVisualRotation = new Matrix3()

function computeNodeGizmoMatrix(
  mountedPrimitive: any,
  newNodeMatrix: Matrix4,
  result?: Matrix4,
): Matrix4 {
  const model = mountedPrimitive._model
  const runtimeNode = getRuntimeNode(mountedPrimitive._node)
  const sceneGraph = mountedPrimitive._sceneGraph || model._sceneGraph
  const axisCorrectionMatrix = mountedPrimitive._axisCorrectionMatrix || Matrix4.IDENTITY

  const modelScale = model.scale ?? 1
  const transformToRoot = runtimeNode?.transformToRoot || Matrix4.IDENTITY
  const componentsTransform = sceneGraph?.components?.transform || Matrix4.IDENTITY

  // 使用新的节点矩阵计算世界矩阵
  Matrix4.multiply(transformToRoot, newNodeMatrix, cngm_scratchStep1)
  Matrix4.multiply(axisCorrectionMatrix, cngm_scratchStep1, cngm_scratchStep2)
  Matrix4.multiply(componentsTransform, cngm_scratchStep2, cngm_scratchStep3)
  if (modelScale !== 1) {
    const scaleMatrix = Matrix4.fromUniformScale(modelScale)
    Matrix4.multiply(scaleMatrix, cngm_scratchStep3, cngm_scratchStep4)
  } else {
    Matrix4.clone(cngm_scratchStep3, cngm_scratchStep4)
  }
  Matrix4.multiply(model.modelMatrix, cngm_scratchStep4, cngm_scratchNodeWorldMatrix)

  // 获取 Visual Offset
  const visualOffset = mountedPrimitive._visualOffset || Matrix4.IDENTITY

  // 提取位置 (物理位置)
  Matrix4.getTranslation(cngm_scratchNodeWorldMatrix, cngm_scratchPosition)
  
  // 提取物理纯旋转 (Remove Scale)
  Matrix4.getMatrix3(cngm_scratchNodeWorldMatrix, cngm_scratchRotationWithScale)
  cngm_scratchCol0.x = cngm_scratchRotationWithScale[0]
  cngm_scratchCol0.y = cngm_scratchRotationWithScale[1]
  cngm_scratchCol0.z = cngm_scratchRotationWithScale[2]
  cngm_scratchCol1.x = cngm_scratchRotationWithScale[3]
  cngm_scratchCol1.y = cngm_scratchRotationWithScale[4]
  cngm_scratchCol1.z = cngm_scratchRotationWithScale[5]
  cngm_scratchCol2.x = cngm_scratchRotationWithScale[6]
  cngm_scratchCol2.y = cngm_scratchRotationWithScale[7]
  cngm_scratchCol2.z = cngm_scratchRotationWithScale[8]
  Cartesian3.normalize(cngm_scratchCol0, cngm_scratchCol0)
  Cartesian3.normalize(cngm_scratchCol1, cngm_scratchCol1)
  Cartesian3.normalize(cngm_scratchCol2, cngm_scratchCol2)
  // 使用 Matrix3.setColumn 避免 TypeScript 只读索引签名问题
  Matrix3.setColumn(cngm_scratchPhysRotationPure, 0, cngm_scratchCol0, cngm_scratchPhysRotationPure)
  Matrix3.setColumn(cngm_scratchPhysRotationPure, 1, cngm_scratchCol1, cngm_scratchPhysRotationPure)
  Matrix3.setColumn(cngm_scratchPhysRotationPure, 2, cngm_scratchCol2, cngm_scratchPhysRotationPure)
  Matrix4.fromRotationTranslation(cngm_scratchPhysRotationPure, Cartesian3.ZERO, cngm_scratchPhysMatrixPure)

  // 应用 Offset: Visual = Physical * Offset
  // 注意：Offset 是纯旋转矩阵，位置偏移通常为0 (因为我们在 mountToNode 是基于同一点计算的)
  // 但为了安全，我们只在旋转层面应用 offset
  Matrix4.multiply(cngm_scratchPhysMatrixPure, visualOffset, cngm_scratchVisualMatrixPure)
  Matrix4.getMatrix3(cngm_scratchVisualMatrixPure, cngm_scratchVisualRotation)

  if (!result) {
    result = new Matrix4()
  }
  return Matrix4.fromRotationTranslation(cngm_scratchVisualRotation, cngm_scratchPosition, result)
}

/**
 * 子节点旋转处理函数 - Local 模式（帧间增量方式）
 */

function applyRotateToNode(
  mountedPrimitive: any,
  pickedGizmoId: GizmoPart | null,
  rotate: Matrix3,
  resultMatrix: Matrix4,
  rotationReferenceMatrix: Matrix4, // 旋转参考系（Gizmo的坐标系）
) {

  const node = mountedPrimitive._node
  const model = mountedPrimitive._model
  const runtimeNode = getRuntimeNode(node)
  const sceneGraph = mountedPrimitive._sceneGraph || model._sceneGraph
  const axisCorrectionMatrix = mountedPrimitive._axisCorrectionMatrix || Matrix4.IDENTITY

  // 获取节点当前的变换矩阵
  const nodeTransform = runtimeNode?.transform || node.matrix || Matrix4.IDENTITY

  // 保存节点的起始矩阵和起始角度（仅在开始旋转时保存一次）
    if (!mountedPrimitive._nodeRotateStartMatrix) {
    mountedPrimitive._nodeRotateStartMatrix = nodeTransform.clone()
    mountedPrimitive._rotateAccumulatedAngle = 0
  }
  const nodeStartMatrix = mountedPrimitive._nodeRotateStartMatrix

  // 1. 确定旋转轴在世界坐标系的方向
  // 根据 pickedGizmoId 和 rotationReferenceMatrix (Gizmo 矩阵) 计算
  const axisLocal = new Cartesian3()
  if (pickedGizmoId === GizmoPart.xAxis) {
    axisLocal.x = 1
  } else if (pickedGizmoId === GizmoPart.yAxis) {
    axisLocal.y = 1
  } else if (pickedGizmoId === GizmoPart.zAxis) {
    axisLocal.z = 1
  } else {
    // 无效轴
    Matrix4.clone(resultMatrix, mountedPrimitive.modelMatrix)
    return
  }

  // World Axis = GizmoRotation * LocalAxis
  // 这里我们只需要方向，所以使用 multiplyByPointAsVector
  const rotationAxisInWorld = Matrix4.multiplyByPointAsVector(
    rotationReferenceMatrix,
    axisLocal,
    new Cartesian3()
  )
  Cartesian3.normalize(rotationAxisInWorld, rotationAxisInWorld)

  // 2. 将世界旋转轴转换为节点局部坐标系的轴
  // NodeWorldMatrix = ModelMatrix * LocalToModel
  
  // 计算 LocalToModel
  const modelScale = model.scale ?? 1
  const transformToRoot = runtimeNode?.transformToRoot || Matrix4.IDENTITY
  const componentsTransform = sceneGraph?.components?.transform || Matrix4.IDENTITY

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

  // NodeWorldMatrix
  const nodeWorldMatrix = Matrix4.multiply(model.modelMatrix, localToModelMatrix, new Matrix4())
  
  // NodeWorldMatrix 的逆矩阵
  const nodeWorldToLocal = Matrix4.inverse(nodeWorldMatrix, new Matrix4())

  // 局部轴 = NodeWorldToLocal * 世界轴
  // 注意：因为包含缩放，inverse 矩阵可能会影响向量长度，所以变换后需要归一化
  const rotationAxisInNodeLocal = Matrix4.multiplyByPointAsVector(nodeWorldToLocal, rotationAxisInWorld, new Cartesian3())
  Cartesian3.normalize(rotationAxisInNodeLocal, rotationAxisInNodeLocal)

  
  // 从 rotate 矩阵提取帧间角度增量
  let frameAngle = 0
  if (pickedGizmoId === GizmoPart.xAxis) {
    frameAngle = Math.atan2(rotate[5], rotate[4])
  } else if (pickedGizmoId === GizmoPart.yAxis) {
    frameAngle = Math.atan2(rotate[6], rotate[8])
  } else if (pickedGizmoId === GizmoPart.zAxis) {
    frameAngle = Math.atan2(rotate[1], rotate[0])
  }

  // 累积角度
  mountedPrimitive._rotateAccumulatedAngle += frameAngle

  // 使用 Quaternion.fromAxisAngle 创建围绕精确轴方向的旋转
  const totalAngle = mountedPrimitive._rotateAccumulatedAngle
  const rotationQuaternion = Quaternion.fromAxisAngle(rotationAxisInNodeLocal, totalAngle, new Quaternion())
  const localRotation = Matrix3.fromQuaternion(rotationQuaternion, new Matrix3())

  // 提取节点起始矩阵的各分量
  const nodeStartRotation = Matrix4.getMatrix3(nodeStartMatrix, new Matrix3())
  const nodeTranslation = Matrix4.getTranslation(nodeStartMatrix, new Cartesian3())
  const nodeScale = Matrix4.getScale(nodeStartMatrix, new Cartesian3())

  // 移除起始矩阵中的 Scale 影响，得到纯旋转矩阵
  const col0 = new Cartesian3(nodeStartRotation[0], nodeStartRotation[1], nodeStartRotation[2])
  const col1 = new Cartesian3(nodeStartRotation[3], nodeStartRotation[4], nodeStartRotation[5])
  const col2 = new Cartesian3(nodeStartRotation[6], nodeStartRotation[7], nodeStartRotation[8])
  Cartesian3.normalize(col0, col0)
  Cartesian3.normalize(col1, col1)
  Cartesian3.normalize(col2, col2)
  const nodeStartRotationPure = new Matrix3(
    col0.x, col1.x, col2.x,
    col0.y, col1.y, col2.y,
    col0.z, col1.z, col2.z
  )

  // 在节点的局部坐标系中应用旋转（右乘）
  // 节点的最终旋转 = 初始旋转 * 累积旋转
  const newNodeRotation = Matrix3.multiply(nodeStartRotationPure, localRotation, new Matrix3())

  // 重建新的节点矩阵：Translation * Rotation * Scale
  const newNodeMatrix = Matrix4.fromRotationTranslation(newNodeRotation, nodeTranslation, new Matrix4())
  Matrix4.multiplyByScale(newNodeMatrix, nodeScale, newNodeMatrix)

  // 更新节点矩阵
  node.matrix = newNodeMatrix
  if (runtimeNode) {
    runtimeNode.transform = newNodeMatrix
  }

  // 使用正确计算的 gizmo 世界矩阵（Local 模式下轴向需跟随节点旋转）
  const gizmoMatrix = computeNodeGizmoMatrix(mountedPrimitive, newNodeMatrix)
  Matrix4.clone(gizmoMatrix, mountedPrimitive.modelMatrix)
}


/**
 * 子节点旋转处理函数 - Surface 模式（使用 ENU 坐标系 + 帧间增量）
 */
function applyRotateToNodeSurface(
  mountedPrimitive: any,
  pickedGizmoId: GizmoPart | null,
  rotate: Matrix3,
  resultMatrix: Matrix4,
  gizmoStartPos: Cartesian3,
  rotateStartEnuMatrix: Matrix4, // ENU 矩阵
) {
  const node = mountedPrimitive._node
  const model = mountedPrimitive._model
  const runtimeNode = getRuntimeNode(node)

  // 获取节点当前的变换矩阵
  const nodeTransform = runtimeNode?.transform || node.matrix || Matrix4.IDENTITY

  // 保存节点的起始矩阵（仅在开始旋转时保存一次）
  if (!mountedPrimitive._nodeRotateStartMatrix) {
    mountedPrimitive._nodeRotateStartMatrix = nodeTransform.clone()
    mountedPrimitive._rotateAccumulatedAngle = 0
  }

  // Surface 模式下，使用 rotateStartEnuMatrix 作为参考系
  applyRotateToNode(mountedPrimitive, pickedGizmoId, rotate, resultMatrix, rotateStartEnuMatrix)
}
