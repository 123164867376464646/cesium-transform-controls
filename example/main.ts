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
const spacing = 0//0.002 // 经度间隔约200米

// // 加载3D模型 (Model Primitive)
// const model = await Cesium.Model.fromGltfAsync({
//   url: 'https://raw.githubusercontent.com/CesiumGS/cesium/main/Apps/SampleData/models/CesiumMilkTruck/CesiumMilkTruck.glb',
//   modelMatrix: Cesium.Transforms.headingPitchRollToFixedFrame(
//     Cesium.Cartesian3.fromDegrees(baseLon, baseLat, baseHeight),
//     new Cesium.HeadingPitchRoll(0, 0, 0),
//   ),
//   debugShowBoundingVolume: false,
//   scale: 10,
// })
// viewer.scene.primitives.add(model)

// // Entity Box
// const boxEntity = viewer.entities.add({
//   name: 'Test Box Entity',
//   position: Cesium.Cartesian3.fromDegrees(baseLon + spacing, baseLat, baseHeight),
//   box: {
//     dimensions: new Cesium.Cartesian3(50, 50, 80),
//     material: Cesium.Color.RED.withAlpha(0.8),
//     outline: true,
//     outlineColor: Cesium.Color.WHITE,
//   },
// })

// 3D Model
const model = await Cesium.Model.fromGltfAsync({
  // url: 'https://raw.githubusercontent.com/CesiumGS/cesium/main/Apps/SampleData/models/CesiumBalloon/CesiumBalloon.glb',
  url: 'luaz.glb',
  modelMatrix: Cesium.Transforms.headingPitchRollToFixedFrame(
    Cesium.Cartesian3.fromDegrees(baseLon, baseLat, baseHeight),
    new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(0), Cesium.Math.toRadians(0), Cesium.Math.toRadians(0)),
  ),
  scale: 10,
  // upAxis:0 //使用X轴为上测试
})
viewer.scene.primitives.add(model)

model.readyEvent.addEventListener(() => {
  console.log('Model:', model)
  const nodeName = 'wheel_FR_luaz_diffuse_0'
  // const nodeName = 'mesh_0_4'
  const node = model.getNode(nodeName)
  console.log('Node:', node)

  // gizmo.mountToPrimitive(model, viewer)
  gizmo.mountToNode(node, model, viewer)

  // 挂载完成后初始化显示位置
  updateCoordinatesFromMatrix(gizmo._mountedPrimitive)

  setTimeout(() => {
    const boundingSphere = model.boundingSphere
    viewer.camera.flyToBoundingSphere(boundingSphere, {
      duration: 0,
      offset: new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(-90),
        Cesium.Math.toRadians(-0),
        boundingSphere.radius * 4
      ),
    })
  }, 1000)
})

// 创建变换控制器
const gizmo = new Gizmo({
  onGizmoPointerMove: (event: any) => {
    updateCoordinatesFromMatrix(gizmo._mountedPrimitive)
  },
})
gizmo.attach(viewer)
;(window as any).gizmo = gizmo

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
  transformMode: 'rotate',
  translateMode: 'local',
  enabled: true,
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

// 初始化为旋转模式
gizmo.setMode(settings.transformMode as GizmoMode)
gizmo.transMode = TranslateMode.local

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
coordsFolder.close()

// 禁用输入框编辑
nameController.domElement.style.pointerEvents = 'none'
typeController.domElement.style.pointerEvents = 'none'

// lonController.domElement.style.pointerEvents = 'none'
// latController.domElement.style.pointerEvents = 'none'
// heightController.domElement.style.pointerEvents = 'none'
// rotateXController.domElement.style.pointerEvents = 'none'
// rotateYController.domElement.style.pointerEvents = 'none'
// rotateZController.domElement.style.pointerEvents = 'none'
// scaleXController.domElement.style.pointerEvents = 'none'
// scaleYController.domElement.style.pointerEvents = 'none'
// scaleZController.domElement.style.pointerEvents = 'none'

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
    // 优先使用 node 的 name 属性，如果没有则尝试从 _runtimeNode 获取
    return node.name || node._runtimeNode?.name || 'ModelNode'
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

//当前显示只是用于简单测试并不严谨,若需要获取坐标情况还得根据真实的业务情况来获取,后续尽量通过回调,将gizmo当前绑定物体暴露出来,用户自信获取其坐标(世界/局部)/旋转/缩放等信息
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

  settings.longitude = longitude.toFixed(6)
  settings.latitude = latitude.toFixed(6)
  settings.height = height.toFixed(2)

  // 提取旋转分量（相对于模型位置的局部 HeadingPitchRoll）
  const hpr = Cesium.Transforms.fixedFrameToHeadingPitchRoll(model.modelMatrix)
  // 转换为度数显示（Heading=Z轴旋转, Pitch=Y轴旋转, Roll=X轴旋转）
  settings.rotateX = Cesium.Math.toDegrees(hpr.roll).toFixed(2)
  settings.rotateY = Cesium.Math.toDegrees(hpr.pitch).toFixed(2)
  settings.rotateZ = Cesium.Math.toDegrees(hpr.heading).toFixed(2)

  // 提取缩放分量
  const scale = model._scale
  settings.scaleX = scale.toFixed(2)
  settings.scaleY = scale.toFixed(2)
  settings.scaleZ = scale.toFixed(2)
}

window.addEventListener('beforeunload', () => {
  gizmo.detach()
  viewer.destroy()
})