import * as Cesium from 'cesium'
import { CoordinateMode, Gizmo, GizmoMode, GizmoPointerDownEvent, GizmoPointerMoveEvent, GizmoPointerUpEvent } from 'cesium-transform-controls'

declare const dat: any

const viewer = new Cesium.Viewer('cesiumContainer', {
  baseLayerPicker: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  navigationHelpButton: false,
  animation: false,
  timeline: false,
  infoBox: false,
})

const baseLon = 106.58446188
const baseLat = 29.57088337
const baseHeight = 0

const model = await Cesium.Model.fromGltfAsync({
  url: './luaz.glb',
  modelMatrix: Cesium.Transforms.headingPitchRollToFixedFrame(
    Cesium.Cartesian3.fromDegrees(baseLon, baseLat, baseHeight),
    new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(0), Cesium.Math.toRadians(0), Cesium.Math.toRadians(0)),
  ),
  scale: 10,
  // upAxis: 0 // 测试：使用 X 轴向上
})
viewer.scene.primitives.add(model)

const testEntity = viewer.entities.add({
  position: Cesium.Cartesian3.fromDegrees(baseLon, baseLat, baseHeight),
  point: {
    pixelSize: 10,
    color: Cesium.Color.RED,
  },
})

const testPolyline = viewer.entities.add({
  name: 'Test Polyline',
  polyline: {
    positions: Cesium.Cartesian3.fromDegreesArray([
      baseLon, baseLat,
      baseLon + 0.01, baseLat + 0.005,
      baseLon + 0.02, baseLat,
    ]),
    width: 4,
    material: Cesium.Color.CYAN,
  },
})

const testPolygon = viewer.entities.add({
  name: 'Test Polygon',
  polygon: {
    hierarchy: Cesium.Cartesian3.fromDegreesArray([
      baseLon - 0.005, baseLat - 0.005,
      baseLon + 0.015, baseLat - 0.005,
      baseLon + 0.015, baseLat + 0.01,
      baseLon - 0.005, baseLat + 0.01,
    ]),
    material: Cesium.Color.YELLOW.withAlpha(0.35),
    outline: true,
    outlineColor: Cesium.Color.YELLOW,
  },
})

const pointCollection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection())
pointCollection.add({
  position: Cesium.Cartesian3.fromDegrees(baseLon + 0.008, baseLat + 0.003, baseHeight + 5),
  color: Cesium.Color.MAGENTA,
  pixelSize: 10,
})
pointCollection.add({
  position: Cesium.Cartesian3.fromDegrees(baseLon - 0.006, baseLat + 0.002, baseHeight + 8),
  color: Cesium.Color.LIME,
  pixelSize: 12,
})

const testBoxDimensions = new Cesium.Cartesian3(20.0, 12.0, 10.0)

const testBox = viewer.entities.add({
  name: 'Test Box',
  position: Cesium.Cartesian3.fromDegrees(baseLon + 0.0006, baseLat - 0.0003, baseHeight + 20),
  box: {
    dimensions: new Cesium.CallbackProperty(() => testBoxDimensions, false),
    material: Cesium.Color.ORANGE.withAlpha(0.6),
    outline: true,
    outlineColor: Cesium.Color.ORANGE,
  },
})
;(testBox as any)._gizmoDimensionsRef = testBoxDimensions

model.readyEvent.addEventListener(() => {
  // const nodeName = 'wheel_FR_luaz_diffuse_0' //轮胎
  const nodeName = 'door_R_luaz_diffuse_0' //车门
  const node = model.getNode(nodeName)

  // gizmo.mountToPrimitive(model, viewer)
  gizmo.mountToNode(node, model, viewer) //手动绑定子节点

  // 挂载完成后初始化显示位置
  updateCoordinatesFromMatrix(gizmo._mountedPrimitive)

  setTimeout(() => {
    const boundingSphere = model.boundingSphere
    viewer.camera.flyToBoundingSphere(boundingSphere, {
      duration: 0,
      offset: new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(-45),
        Cesium.Math.toRadians(-15),
        boundingSphere.radius * 3
      ),
    })
  }, 1000)
})

const settings = {
  transformMode: 'translate',
  translateMode: 'local',
  enabled: true,
  showLocalBounds: true,
  showWorldAABB: false,
  // 经纬度显示
  longitude: '0.000000',
  latitude: '0.000000',
  height: '0.00',
  // 旋转分量（度）
  rotateX: '0.00',
  rotateY: '0.00',
  rotateZ: '0.00',
  // 缩放分量
  scaleX: '1.00',
  scaleY: '1.00',
  scaleZ: '1.00',
}

const gizmo = new Gizmo({
  showLocalBounds: settings.showLocalBounds,
  showWorldAABB: settings.showWorldAABB,
  onGizmoPointerMove: (event: GizmoPointerMoveEvent) => {
    console.log('[Gizmo Move]', event)
    updateCoordinatesFromMatrix(gizmo._mountedPrimitive)
  },
  onGizmoPointerDown: (event: GizmoPointerDownEvent) => {
    console.log('[Gizmo Down]', event)
  },
  onGizmoPointerUp: (event: GizmoPointerUpEvent) => {
    console.log('[Gizmo Up]', event)
  }
})
gizmo.attach(viewer)
gizmo.setMode(settings.transformMode as GizmoMode)
gizmo.coordinateMode = CoordinateMode.local

const gui = new dat.GUI({ name: '变换控制器' })

let translateModeController: any
let savedCoordinateMode: string = 'local'

gui.add(settings, 'transformMode', ['translate', 'rotate', 'scale']).name('transformMode').onChange((value: string) => {
  switch (value) {
    case 'translate':
      gizmo.setMode(GizmoMode.translate)
      break
    case 'rotate':
      gizmo.setMode(GizmoMode.rotate)
      break
    case 'scale':
      gizmo.setMode(GizmoMode.scale)
      break
  }
  // 当 scale 模式时，禁用 coordinateMode 控制器（缩放只支持局部坐标系）
  if (value === 'scale') {
    savedCoordinateMode = settings.translateMode
    gizmo.coordinateMode = CoordinateMode.local
    translateModeController.domElement.style.pointerEvents = 'none'
    translateModeController.domElement.style.opacity = '0.5'
  } else {
    translateModeController.domElement.style.pointerEvents = 'auto'
    translateModeController.domElement.style.opacity = '1'
    settings.translateMode = savedCoordinateMode
    gizmo.coordinateMode = savedCoordinateMode === 'surface' ? CoordinateMode.surface : CoordinateMode.local
    translateModeController.updateDisplay()
  }
})

translateModeController = gui.add(settings, 'translateMode', ['local', 'surface']).name('coordinateMode').onChange((value: string) => {
  savedCoordinateMode = value // 保持 savedCoordinateMode 同步，避免切换 transformMode 时丢失
  switch (value) {
    case 'local':
      gizmo.coordinateMode = CoordinateMode.local
      break
    case 'surface':
      gizmo.coordinateMode = CoordinateMode.surface
      break
  }
})

gui.add(settings, 'enabled').name('enabled').onChange((value: boolean) => {
  gizmo.setEnabled(value)
})

// 包围盒显隐控制
gui.add(settings, 'showLocalBounds').name('LocalBounds').onChange((value: boolean) => {
  gizmo.setShowLocalBounds(value)
})
gui.add(settings, 'showWorldAABB').name('WorldAABB').onChange((value: boolean) => {
  gizmo.setShowWorldAABB(value)
})

// 拾取信息显示 GUI（顺序：名称、类型、经纬度、高度）
const coordsFolder = gui.addFolder('信息')
// 添加拾取对象信息
const pickSettings = {
  modelName: '-',
  modelType: '-',
}
const nameController = coordsFolder.add(pickSettings, 'modelName').name('名称').listen()
const typeController = coordsFolder.add(pickSettings, 'modelType').name('类型').listen()
const lonController = coordsFolder.add(settings, 'longitude').name('经度').listen()
const latController = coordsFolder.add(settings, 'latitude').name('纬度').listen()
const heightController = coordsFolder.add(settings, 'height').name('高度 (m)').listen()
// 旋转分量显示
const rotateXController = coordsFolder.add(settings, 'rotateX').name('旋转 X (°)').listen()
const rotateYController = coordsFolder.add(settings, 'rotateY').name('旋转 Y (°)').listen()
const rotateZController = coordsFolder.add(settings, 'rotateZ').name('旋转 Z (°)').listen()
// 缩放分量显示
const scaleXController = coordsFolder.add(settings, 'scaleX').name('缩放 X').listen()
const scaleYController = coordsFolder.add(settings, 'scaleY').name('缩放 Y').listen()
const scaleZController = coordsFolder.add(settings, 'scaleZ').name('缩放 Z').listen()
coordsFolder.open()

// 禁用输入框编辑
nameController.domElement.style.pointerEvents = 'none'
typeController.domElement.style.pointerEvents = 'none'

lonController.onFinishChange(() => {
  applyPositionFromGui()
})
latController.onFinishChange(() => {
  applyPositionFromGui()
})
heightController.onFinishChange(() => {
  applyPositionFromGui()
})

// 从 Gizmo 挂载的 primitive 获取模型类型
function getMountedObjectType(mounted: any): string {
  if (!mounted) return '-'

  // Entity (通过 _isEntity 标记判断)
  if (mounted._isEntity) {
    return 'Entity'
  }

  // 检查是否是子节点（ModelNode）
  if (mounted._isNode && mounted._node) {
    return 'ModelNode'
  }

  // 检查是否是 3D Tiles
  if (mounted.tileset || mounted.content?.tileset) {
    return '3DTiles'
  }

  // 检查是否是 Model
  if (mounted instanceof Cesium.Model) {
    return 'Model'
  }

  // 其他 Primitive
  if (mounted.modelMatrix) {
    return mounted.constructor?.name || 'Primitive'
  }

  return 'Unknown'
}

// 从 Gizmo 挂载的 primitive 获取模型名称
function getMountedObjectName(mounted: any): string {
  if (!mounted) return '-'

  // Entity
  if (mounted._isEntity && mounted._entity) {
    const entity = mounted._entity
    return entity.name || entity.id || 'Entity'
  }

  // 检查是否是子节点（ModelNode）
  if (mounted._isNode && mounted._node) {
    const node = mounted._node
    // 支持 ModelNode（.name）和 ModelRuntimeNode（._name）
    return node.name || node._name || 'ModelNode'
  }

  // 3D Tiles
  if (mounted.tileset) {
    return mounted.tileset._url?.split('/').pop() || '3D Tileset'
  }
  if (mounted.content?.tileset) {
    return mounted.content.tileset._url?.split('/').pop() || '3D Tileset'
  }

  // Model
  if (mounted instanceof Cesium.Model) {
    const url = (mounted as any)._resource?._url || (mounted as any)._url || ''
    const fileName = url.split('/').pop()?.split('?')[0] || 'Model'
    return fileName
  }

  // 其他 Primitive
  if (mounted.modelMatrix) {
    return mounted.constructor?.name || 'Primitive'
  }

  return '-'
}

// 更新挂载模型信息到 GUI（复用 Gizmo 内部的 _show 状态）
// 仅更新了名称、类型用于测试
function updateMountedObjectInfo() {
  const mounted = (gizmo as any)._mountedPrimitive
  // 检查任意模式的 Gizmo 是否可见（平移/旋转/缩放）
  const isTransVisible = (gizmo as any)._transPrimitives?._show ?? false
  const isRotateVisible = (gizmo as any)._rotatePrimitives?._show ?? false
  const isScaleVisible = (gizmo as any)._scalePrimitives?._show ?? false
  const isGizmoVisible = isTransVisible || isRotateVisible || isScaleVisible

  if (mounted && isGizmoVisible) {
    pickSettings.modelName = getMountedObjectName(mounted)
    pickSettings.modelType = getMountedObjectType(mounted)
    coordsFolder.show()
  } else {
    pickSettings.modelName = '-'
    pickSettings.modelType = '-'
    coordsFolder.hide()
  }
}

// 通过 preRender 事件监听 Gizmo 的 _show 状态变化（点击空白时 Gizmo 会设置 _show = false）
viewer.scene.preRender.addEventListener(updateMountedObjectInfo)

// 初始化显示当前挂载的模型信息
updateMountedObjectInfo()

// 当前显示仅用于测试。真实业务场景中，应通过回调获取 Gizmo 绑定的对象，并根据其类型（Entity/Model/Tileset）准确获取世界/局部坐标、旋转和缩放信息。
function updateCoordinatesFromMatrix(model: any) {
  const position = Cesium.Matrix4.getTranslation(model.modelMatrix, new Cesium.Cartesian3())
  const cartographic = Cesium.Cartographic.fromCartesian(position)

  // 检查坐标是否有效
  if (!cartographic) {
    settings.longitude = '-'
    settings.latitude = '-'
    settings.height = '-'
    settings.rotateX = '-'
    settings.rotateY = '-'
    settings.rotateZ = '-'
    settings.scaleX = '-'
    settings.scaleY = '-'
    settings.scaleZ = '-'
    return
  }

  //弧度转角度
  const longitude = Cesium.Math.toDegrees(cartographic.longitude)
  const latitude = Cesium.Math.toDegrees(cartographic.latitude)
  const height = cartographic.height

  settings.longitude = longitude.toFixed(8)
  settings.latitude = latitude.toFixed(8)
  settings.height = height.toFixed(2)

  // 提取旋转分量
  if (model._isNode && model._node) {
    const node = model._node
    let mat = node.matrix
    if (!mat && node._runtimeNode && node._runtimeNode.transform) {
      mat = node._runtimeNode.transform
    }
    if (!mat) {
      mat = Cesium.Matrix4.IDENTITY
    }

    // 提取 Rotation Matrix (去掉 Scale)
    const m3 = new Cesium.Matrix3()
    Cesium.Matrix4.getMatrix3(mat, m3)

    // 归一化以移除缩放影响
    const c0 = Cesium.Cartesian3.fromElements(m3[0], m3[1], m3[2])
    const c1 = Cesium.Cartesian3.fromElements(m3[3], m3[4], m3[5])
    const c2 = Cesium.Cartesian3.fromElements(m3[6], m3[7], m3[8])
    Cesium.Cartesian3.normalize(c0, c0)
    Cesium.Cartesian3.normalize(c1, c1)
    Cesium.Cartesian3.normalize(c2, c2)

    // 重组纯旋转矩阵
    const r00 = c0.x; const r01 = c1.x; const r02 = c2.x;
    const r10 = c0.y; const r11 = c1.y; const r12 = c2.y;
    const r20 = c0.z; const r21 = c1.z; const r22 = c2.z;

    // 分解 Euler Angles (Sequence: Z -> Y -> X,  R = Mz * My * Mx)
    // Y = -asin(R20)
    // X = atan2(R21, R22)
    // Z = atan2(R10, R00)

    let x = 0, y = 0, z = 0
    if (Math.abs(r20) < 0.99999) {
      y = Math.asin(-r20)
      x = Math.atan2(r21, r22)
      z = Math.atan2(r10, r00)
    } else {
      // Gimbal Lock
      y = Math.PI / 2 * Math.sign(-r20)
      z = 0
      x = Math.atan2(-r12, r11)
    }

    settings.rotateX = Cesium.Math.toDegrees(x).toFixed(2)
    settings.rotateY = Cesium.Math.toDegrees(y).toFixed(2)
    settings.rotateZ = Cesium.Math.toDegrees(z).toFixed(2)

  } else {
    // 对于 Root Model，使用 Cesium 提供的 ENU 转换
    // 转换为度数显示（Heading=Z轴旋转, Pitch=Y轴旋转, Roll=X轴旋转）
    const hpr = Cesium.Transforms.fixedFrameToHeadingPitchRoll(model.modelMatrix)
    settings.rotateX = Cesium.Math.toDegrees(hpr.roll).toFixed(2)
    settings.rotateY = Cesium.Math.toDegrees(hpr.pitch).toFixed(2)
    settings.rotateZ = Cesium.Math.toDegrees(hpr.heading).toFixed(2)
  }

  // 提取缩放分量
  // 无论是 Node 还是 Model，Gizmo 缩放操作都会更新对应的 Matrix (node.matrix 或 model.modelMatrix)
  // 因此统一从 Matrix 中提取缩放最为准确
  let targetMatrix = Cesium.Matrix4.IDENTITY
  if (model._isNode && model._node) {
    const node = model._node
    if (node.matrix) {
      targetMatrix = node.matrix
    } else if (node._runtimeNode && node._runtimeNode.transform) {
      targetMatrix = node._runtimeNode.transform
    }
  } else {
    // Root Model
    targetMatrix = model.modelMatrix
  }

  const scale = Cesium.Matrix4.getScale(targetMatrix, new Cesium.Cartesian3())

  // 对于 Root Model，还需要乘以 model.scale (uniform independent scale)
  // Total Scale = model.scale * matrix_scale
  let uniformScale = 1.0
  if (!model._isNode && typeof model.scale === 'number') {
    uniformScale = model.scale
  }

  settings.scaleX = (scale.x * uniformScale).toFixed(2)
  settings.scaleY = (scale.y * uniformScale).toFixed(2)
  settings.scaleZ = (scale.z * uniformScale).toFixed(2)
}

function applyPositionFromGui() {
  const longitude = parseGuiNumber(settings.longitude)
  const latitude = parseGuiNumber(settings.latitude)
  const height = parseGuiNumber(settings.height)

  if (longitude === null || latitude === null || height === null) {
    return
  }

  const targetPosition = Cesium.Cartesian3.fromDegrees(longitude, latitude, height)
  applyMountedWorldPosition(targetPosition)
  const mounted = (gizmo as any)._mountedPrimitive
  if (mounted) {
    updateCoordinatesFromMatrix(mounted)
  }
}

function parseGuiNumber(value: string) {
  const parsed = Number.parseFloat(String(value))
  return Number.isFinite(parsed) ? parsed : null
}

function applyMountedWorldPosition(targetPosition: Cesium.Cartesian3) {
  const mounted = (gizmo as any)._mountedPrimitive
  if (!mounted) {
    return
  }

  if (mounted._isEntity) {
    const entity = mounted._entity
    if (entity) {
      setEntityPosition(entity, targetPosition)
      ;(gizmo as any)._lastSyncedPosition = targetPosition.clone()
    }
    gizmo.forceSyncFromMountedPrimitive()
    return
  }

  if (mounted._isNode) {
    applyWorldPositionToNode(mounted, targetPosition)
    return
  }

  if (mounted.modelMatrix) {
    const newGizmoMatrix = Cesium.Matrix4.clone(gizmo.modelMatrix, new Cesium.Matrix4())
    Cesium.Matrix4.setTranslation(newGizmoMatrix, targetPosition, newGizmoMatrix)
    Cesium.Matrix4.clone(newGizmoMatrix, gizmo.modelMatrix)

    const newPrimitiveMatrix = Cesium.Matrix4.clone(mounted.modelMatrix, new Cesium.Matrix4())
    Cesium.Matrix4.setTranslation(newPrimitiveMatrix, targetPosition, newPrimitiveMatrix)
    mounted.modelMatrix = newPrimitiveMatrix
  }
}

function setEntityPosition(entity: any, position: Cesium.Cartesian3) {
  if (!entity) {
    return
  }
  if (entity.position && typeof entity.position.setValue === 'function') {
    entity.position.setValue(position)
  } else {
    entity.position = new Cesium.ConstantPositionProperty(position)
  }
}

function getRuntimeNode(node: any) {
  if (!node) {
    return null
  }
  if (node._runtimeNode) {
    return node._runtimeNode
  }
  if (node.transform !== undefined || node.transformToRoot !== undefined) {
    return node
  }
  return null
}

function applyWorldPositionToNode(mounted: any, targetPosition: Cesium.Cartesian3) {
  const currentPosition = Cesium.Matrix4.getTranslation(mounted.modelMatrix, new Cesium.Cartesian3())
  const deltaWorld = Cesium.Cartesian3.subtract(targetPosition, currentPosition, new Cesium.Cartesian3())

  if (Cesium.Cartesian3.equalsEpsilon(deltaWorld, Cesium.Cartesian3.ZERO, 1e-6)) {
    return
  }

  const node = mounted._node
  const model = mounted._model
  if (!node || !model) {
    return
  }

  const runtimeNode = getRuntimeNode(node)
  const sceneGraph = mounted._sceneGraph || model._sceneGraph
  const axisCorrectionMatrix = mounted._axisCorrectionMatrix || Cesium.Matrix4.IDENTITY

  const nodeTransform = runtimeNode?.transform || node.matrix || Cesium.Matrix4.IDENTITY
  const transformToRoot = runtimeNode?.transformToRoot || Cesium.Matrix4.IDENTITY
  const componentsTransform = sceneGraph?.components?.transform || Cesium.Matrix4.IDENTITY
  const modelScale = model.scale ?? 1

  const step1 = Cesium.Matrix4.multiply(transformToRoot, nodeTransform, new Cesium.Matrix4())
  const step2 = Cesium.Matrix4.multiply(axisCorrectionMatrix, step1, new Cesium.Matrix4())
  const step3 = Cesium.Matrix4.multiply(componentsTransform, step2, new Cesium.Matrix4())
  const step4 = modelScale !== 1
    ? Cesium.Matrix4.multiply(Cesium.Matrix4.fromUniformScale(modelScale), step3, new Cesium.Matrix4())
    : step3
  const nodeWorldMatrix = Cesium.Matrix4.multiply(model.modelMatrix, step4, new Cesium.Matrix4())

  const inverseNodeWorld = Cesium.Matrix4.inverse(nodeWorldMatrix, new Cesium.Matrix4())
  const deltaInNode = Cesium.Matrix4.multiplyByPointAsVector(inverseNodeWorld, deltaWorld, new Cesium.Cartesian3())

  const translationMatrix = Cesium.Matrix4.fromTranslation(deltaInNode, new Cesium.Matrix4())
  const newNodeMatrix = Cesium.Matrix4.multiply(nodeTransform, translationMatrix, new Cesium.Matrix4())

  node.matrix = Cesium.Matrix4.clone(newNodeMatrix, node.matrix || new Cesium.Matrix4())
  if (runtimeNode) {
    runtimeNode.transform = Cesium.Matrix4.clone(newNodeMatrix, runtimeNode.transform || new Cesium.Matrix4())
  }

  const newGizmoMatrix = Cesium.Matrix4.clone(mounted.modelMatrix, new Cesium.Matrix4())
  Cesium.Matrix4.setTranslation(newGizmoMatrix, targetPosition, newGizmoMatrix)
  mounted.modelMatrix = newGizmoMatrix
  Cesium.Matrix4.clone(newGizmoMatrix, gizmo.modelMatrix)
}

window.addEventListener('beforeunload', () => {
  gizmo.detach()
  viewer.destroy()
})

function toGlobal(attrs: Record<string, any>) {
  for (const [key, value] of Object.entries(attrs)) {
    (window as any)[key] = value
  }
}

toGlobal({
  Cesium,
  viewer,
  model,
  gizmo,
})
