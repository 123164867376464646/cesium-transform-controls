import type * as CesiumType from 'cesium'
import type { Gizmo } from 'cesium-transform-controls'

export interface GuiSettings {
  transformMode: 'translate' | 'rotate' | 'scale'
  translateMode: 'local' | 'surface'
  enabled: boolean
  showLocalBounds: boolean
  showWorldAABB: boolean
  longitude: string
  latitude: string
  height: string
  rotateX: string
  rotateY: string
  rotateZ: string
  scaleX: string
  scaleY: string
  scaleZ: string
}

export const defaultSettings: GuiSettings = {
  transformMode: 'translate',
  translateMode: 'local',
  enabled: true,
  showLocalBounds: true,
  showWorldAABB: false,
  longitude: '0.000000',
  latitude: '0.000000',
  height: '0.00',
  rotateX: '0.00',
  rotateY: '0.00',
  rotateZ: '0.00',
  scaleX: '1.00',
  scaleY: '1.00',
  scaleZ: '1.00',
}

declare const dat: any

export class GuiManager {
  private gui: any
  private settings: GuiSettings
  private gizmo: Gizmo
  private viewer: CesiumType.Viewer
  private Cesium: typeof CesiumType
  
  private translateModeController: any
  private coordsFolder: any
  private pickSettings = {
    modelName: '-',
    modelType: '-',
  }
  private pickControllers: Record<string, any> = {}

  constructor(
      Cesium: typeof CesiumType,
      gizmo: Gizmo, 
      viewer: CesiumType.Viewer, 
      settings: GuiSettings = defaultSettings
  ) {
    this.Cesium = Cesium
    this.gizmo = gizmo
    this.viewer = viewer
    this.settings = settings
    this.gui = new dat.GUI({ name: '变换控制器' })
    
    this.initMainControls()
    this.initInfoControls()
    
    this.viewer.scene.preRender.addEventListener(this.update.bind(this))
  }

  private initMainControls() {
    this.gui.add(this.settings, 'transformMode', ['translate', 'rotate', 'scale'])
      .name('transformMode')
      .onChange((value: string) => {
        // Use string literals
        this.gizmo.setMode(value as any)
        
        if (value === 'scale') {
          if (this.gizmo.coordinateMode !== null) {
              this.gizmo.coordinateMode = 'local' as any
          }
          this.translateModeController.domElement.style.pointerEvents = 'none'
          this.translateModeController.domElement.style.opacity = '0.5'
        } else {
          this.translateModeController.domElement.style.pointerEvents = 'auto'
          this.translateModeController.domElement.style.opacity = '1'
          this.gizmo.coordinateMode = (this.settings.translateMode === 'surface' ? 'surface' : 'local') as any
          this.translateModeController.updateDisplay()
        }
      })

    this.translateModeController = this.gui.add(this.settings, 'translateMode', ['local', 'surface'])
      .name('coordinateMode')
      .onChange((value: string) => {
        this.gizmo.coordinateMode = (value === 'local' ? 'local' : 'surface') as any
      })

    this.gui.add(this.settings, 'enabled').name('enabled').onChange((value: boolean) => {
      this.gizmo.setEnabled(value)
    })

    this.gui.add(this.settings, 'showLocalBounds').name('LocalBounds').onChange((value: boolean) => {
      this.gizmo.setShowLocalBounds(value)
    })
    this.gui.add(this.settings, 'showWorldAABB').name('WorldAABB').onChange((value: boolean) => {
      this.gizmo.setShowWorldAABB(value)
    })
  }

  private initInfoControls() {
    this.coordsFolder = this.gui.addFolder('信息')
    const nameCtrl = this.coordsFolder.add(this.pickSettings, 'modelName').name('名称').listen()
    const typeCtrl = this.coordsFolder.add(this.pickSettings, 'modelType').name('类型').listen()
    
    nameCtrl.domElement.style.pointerEvents = 'none'
    typeCtrl.domElement.style.pointerEvents = 'none'
    
    this.pickControllers.lon = this.coordsFolder.add(this.settings, 'longitude').name('经度').listen()
    this.pickControllers.lat = this.coordsFolder.add(this.settings, 'latitude').name('纬度').listen()
    this.pickControllers.height = this.coordsFolder.add(this.settings, 'height').name('高度 (m)').listen()
    
    this.coordsFolder.add(this.settings, 'rotateX').name('旋转 X (°)').listen()
    this.coordsFolder.add(this.settings, 'rotateY').name('旋转 Y (°)').listen()
    this.coordsFolder.add(this.settings, 'rotateZ').name('旋转 Z (°)').listen()
    
    this.coordsFolder.add(this.settings, 'scaleX').name('缩放 X').listen()
    this.coordsFolder.add(this.settings, 'scaleY').name('缩放 Y').listen()
    this.coordsFolder.add(this.settings, 'scaleZ').name('缩放 Z').listen()
    
    this.coordsFolder.open()
    
    const applyPos = () => this.applyPositionFromGui()
    this.pickControllers.lon.onFinishChange(applyPos)
    this.pickControllers.lat.onFinishChange(applyPos)
    this.pickControllers.height.onFinishChange(applyPos)
  }

  public update() {
    this.updateMountedObjectInfo()
  }
  
  private updateMountedObjectInfo() {
    const mounted = (this.gizmo as any)._mountedPrimitive
    const isTransVisible = (this.gizmo as any)._transPrimitives?._show ?? false
    const isGizmoVisible = isTransVisible
      || ((this.gizmo as any)._rotatePrimitives?._show ?? false)
      || ((this.gizmo as any)._scalePrimitives?._show ?? false)

    if (mounted && isGizmoVisible) {
      this.pickSettings.modelName = this.getMountedObjectName(mounted)
      this.pickSettings.modelType = this.getMountedObjectType(mounted)
      this.coordsFolder.show()
    } else {
      this.pickSettings.modelName = '-'
      this.pickSettings.modelType = '-'
      this.coordsFolder.hide()
    }
  }

  private getMountedObjectName(mounted: any): string {
    if (!mounted) return '-'
    if (mounted._isEntity && mounted._entity) {
      const entity = mounted._entity
      return entity.name || entity.id || 'Entity'
    }
    if (mounted._isNode && mounted._node) {
      const node = mounted._node
      return node.name || node._name || 'ModelNode'
    }
    if (mounted instanceof this.Cesium.Model) {
      // @ts-ignore
      const url = mounted._resource?._url || mounted._url || ''
      return url.split('/').pop()?.split('?')[0] || 'Model'
    }
    return 'Object'
  }

  private getMountedObjectType(mounted: any): string {
    if (!mounted) return '-'
    if (mounted._isEntity) return 'Entity'
    if (mounted._isNode) return 'ModelNode'
    if (mounted instanceof this.Cesium.Model) return 'Model'
    return 'Primitive'
  }

  public updateCoordinates(model: any) {
    if (model) updateCoordinatesFromMatrix(this.Cesium, model, this.settings)
  }

  private applyPositionFromGui() {
     const lon = parseFloat(this.settings.longitude)
     const lat = parseFloat(this.settings.latitude)
     const height = parseFloat(this.settings.height)
     if (isNaN(lon) || isNaN(lat) || isNaN(height)) return

     const targetPos = this.Cesium.Cartesian3.fromDegrees(lon, lat, height)
     this.applyMountedWorldPosition(targetPos)
     
     const mounted = (this.gizmo as any)._mountedPrimitive
     if (mounted) this.updateCoordinates(mounted)
  }

  private applyMountedWorldPosition(targetPosition: CesiumType.Cartesian3) {
      const mounted = (this.gizmo as any)._mountedPrimitive
      if (!mounted) return
      
      const Cesium = this.Cesium
      
      if (mounted._isEntity) {
          const entity = mounted._entity
          if (entity.position && typeof entity.position.setValue === 'function') {
            entity.position.setValue(targetPosition)
          } else {
            entity.position = new Cesium.ConstantPositionProperty(targetPosition)
          }
           ;(this.gizmo as any)._lastSyncedPosition = targetPosition.clone()
           this.gizmo.forceSyncFromMountedPrimitive()
           return
      }
      
      if (mounted._isNode) {
          console.warn('Node position update via GUI not fully implemented in refactoring yet')
      }
      
      if (mounted.modelMatrix && !mounted._isNode) {
           const newGizmoMatrix = Cesium.Matrix4.clone(this.gizmo.modelMatrix, new Cesium.Matrix4())
           Cesium.Matrix4.setTranslation(newGizmoMatrix, targetPosition, newGizmoMatrix)
           Cesium.Matrix4.clone(newGizmoMatrix, this.gizmo.modelMatrix)

           const newPrimitiveMatrix = Cesium.Matrix4.clone(mounted.modelMatrix, new Cesium.Matrix4())
           Cesium.Matrix4.setTranslation(newPrimitiveMatrix, targetPosition, newPrimitiveMatrix)
           mounted.modelMatrix = newPrimitiveMatrix
      }
  }
}

// Function needs Cesium injected
export function updateCoordinatesFromMatrix(Cesium: typeof CesiumType, model: any, settings: GuiSettings) {
  const position = Cesium.Matrix4.getTranslation(model.modelMatrix, new Cesium.Cartesian3())
  const cartographic = Cesium.Cartographic.fromCartesian(position)

  if (!cartographic) return

  settings.longitude = Cesium.Math.toDegrees(cartographic.longitude).toFixed(8)
  settings.latitude = Cesium.Math.toDegrees(cartographic.latitude).toFixed(8)
  settings.height = cartographic.height.toFixed(2)
}
