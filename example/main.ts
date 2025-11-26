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
})

// 加载3D模型
const model = await Cesium.Model.fromGltfAsync({
  url: 'https://raw.githubusercontent.com/CesiumGS/cesium/main/Apps/SampleData/models/CesiumBalloon/CesiumBalloon.glb',
  modelMatrix: Cesium.Transforms.headingPitchRollToFixedFrame(
    Cesium.Cartesian3.fromDegrees(106.580810, 29.557070, 100),
    new Cesium.HeadingPitchRoll(0, 0, 0),
  ),
  debugShowBoundingVolume: false,
  scale: 10,
})
viewer.scene.primitives.add(model)

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
}

const gui = new dat.GUI({ name: '变换控制器' })

// 先声明变量
let translateModeController: any

// 变换模式选择（放在最上面）
gui.add(settings, 'transformMode', ['translate', 'rotate', 'scale']).name('transformMode').onChange((value: string) => {
  switch (value) {
    case 'translate':
      gizmo.setMode(GizmoMode.translate)
      translateModeController.show() // 显示平移坐标系选项
      break
    case 'rotate':
      gizmo.setMode(GizmoMode.rotate)
      translateModeController.hide() // 隐藏平移坐标系选项
      break
    case 'scale':
      gizmo.setMode(GizmoMode.scale)
      translateModeController.hide() // 隐藏平移坐标系选项
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

window.addEventListener('beforeunload', () => {
  gizmo.detach()
  viewer.destroy()
})
