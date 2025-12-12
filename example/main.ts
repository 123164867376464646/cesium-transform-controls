import * as Cesium from 'cesium'
import { Gizmo, GizmoMode, TranslateMode } from '../src/index'

// 声明全局 dat 对象
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

// 基础位置（用于物体排列）
const baseLon = 106.580810
const baseLat = 29.557070
const baseHeight = 100
const spacing = 0.002 // 经度间隔约200米

// 加载3D模型 (Model Primitive)
const model = await Cesium.Model.fromGltfAsync({
  url: 'https://raw.githubusercontent.com/CesiumGS/cesium/main/Apps/SampleData/models/CesiumBalloon/CesiumBalloon.glb',
  modelMatrix: Cesium.Transforms.headingPitchRollToFixedFrame(
    Cesium.Cartesian3.fromDegrees(baseLon, baseLat, baseHeight),
    new Cesium.HeadingPitchRoll(0, 0, 0),
  ),
  debugShowBoundingVolume: false,
  scale: 10,
})
viewer.scene.primitives.add(model)

// Entity Box
const boxEntity = viewer.entities.add({
  name: 'Test Box Entity',
  position: Cesium.Cartesian3.fromDegrees(baseLon + spacing, baseLat, baseHeight),
  box: {
    dimensions: new Cesium.Cartesian3(50, 50, 80),
    material: Cesium.Color.RED.withAlpha(0.8),
    outline: true,
    outlineColor: Cesium.Color.WHITE,
  },
})

// 3D Model
const model2 = await Cesium.Model.fromGltfAsync({
  url: 'https://raw.githubusercontent.com/CesiumGS/cesium/main/Apps/SampleData/models/CesiumMilkTruck/CesiumMilkTruck.glb',
  modelMatrix: Cesium.Transforms.headingPitchRollToFixedFrame(
    Cesium.Cartesian3.fromDegrees(baseLon - spacing, baseLat, baseHeight),
    new Cesium.HeadingPitchRoll(0, 0, 0),
  ),
  scale: 15,
})
viewer.scene.primitives.add(model2)

// 创建变换控制器
const gizmo = new Gizmo({
  onGizmoPointerMove: (event: any) => {
    console.log('Transform:', event)
  },
})

gizmo.attach(viewer)
gizmo.mountToPrimitive(model, viewer)

// 设置相机视角
const modelPosition = Cesium.Cartesian3.fromDegrees(106.580810, 29.557070, 100)
const offset = new Cesium.HeadingPitchRange(
  Cesium.Math.toRadians(-20),
  Cesium.Math.toRadians(-20),
  1000
)

viewer.camera.lookAt(modelPosition, offset)
viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)

// 使用 dat.gui 创建控制面板
const settings = {
  transformMode: 'translate',
  translateMode: 'local',
  enabled: true,
  // 经纬度显示
  longitude: '0.000000',
  latitude: '0.000000',
  height: '0.00',
}

const gui = new dat.GUI({ name: '变换控制器' })

// 先声明变量
let translateModeController: any

// 变换模式选择（放在最上面）
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
})

// 平移坐标系选择（仅在平移模式下显示）
translateModeController = gui.add(settings, 'translateMode', ['local', 'surface']).name('translateMode').onChange((value: string) => {
  switch (value) {
    case 'local':
      gizmo.transMode = TranslateMode.local
      break
    case 'surface':
      gizmo.transMode = TranslateMode.surface
      break
  }
})

// 启用/禁用控制
gui.add(settings, 'enabled').name('enabled').onChange((value: boolean) => {
  gizmo.setEnabled(value)
})

// 初始化为平移模式
gizmo.setMode(GizmoMode.translate)
gizmo.transMode = TranslateMode.local

// 拾取信息显示 GUI
const coordsFolder = gui.addFolder('信息')
const lonController = coordsFolder.add(settings, 'longitude').name('经度').listen()
const latController = coordsFolder.add(settings, 'latitude').name('纬度').listen()
const heightController = coordsFolder.add(settings, 'height').name('高度 (m)').listen()

// 添加拾取对象信息
const pickSettings = {
  modelName: '-',
  modelType: '-',
}
const nameController = coordsFolder.add(pickSettings, 'modelName').name('模型名称').listen()
const typeController = coordsFolder.add(pickSettings, 'modelType').name('模型类型').listen()
coordsFolder.open()

// 禁用输入框编辑
lonController.domElement.style.pointerEvents = 'none'
latController.domElement.style.pointerEvents = 'none'
heightController.domElement.style.pointerEvents = 'none'
nameController.domElement.style.pointerEvents = 'none'
typeController.domElement.style.pointerEvents = 'none'

// 从 Gizmo 挂载的 primitive 获取模型类型
function getMountedObjectType(mounted: any): string {
  if (!mounted) return '-'
  
  // Entity (通过 _isEntity 标记判断)
  if (mounted._isEntity) {
    return 'Entity'
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
function updateMountedObjectInfo() {
  const mounted = (gizmo as any)._mountedPrimitive
  const isGizmoVisible = (gizmo as any)._transPrimitives?._show ?? false
  
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

// 从 modelMatrix 提取位置并更新 GUI
function updateCoordinatesFromMatrix(matrix: Cesium.Matrix4) {
  const position = Cesium.Matrix4.getTranslation(matrix, new Cesium.Cartesian3())
  const cartographic = Cesium.Cartographic.fromCartesian(position)
  const longitude = Cesium.Math.toDegrees(cartographic.longitude)
  const latitude = Cesium.Math.toDegrees(cartographic.latitude)
  const height = cartographic.height

  settings.longitude = longitude.toFixed(6)
  settings.latitude = latitude.toFixed(6)
  settings.height = height.toFixed(2)
}

// 初始化显示模型当前位置
updateCoordinatesFromMatrix(gizmo.modelMatrix)

// 在 gizmo 变换时更新坐标显示
gizmo.onGizmoPointerMove = (event: any) => {
  console.log('Transform:', event)
  updateCoordinatesFromMatrix(gizmo.modelMatrix)
}

window.addEventListener('beforeunload', () => {
  gizmo.detach()
  viewer.destroy()
})
