import type * as CesiumType from 'cesium'
import type { Gizmo } from 'cesium-transform-controls'
import type { TestObject } from './TestLoader'
import { GuiManager } from './GuiManager'

export class ObjectList {
    private container: HTMLElement
    private viewer: CesiumType.Viewer
    private gizmo: Gizmo
    private Cesium: typeof CesiumType
    private guiManager: GuiManager

    constructor(
        Cesium: typeof CesiumType, 
        viewer: CesiumType.Viewer, 
        gizmo: Gizmo, 
        guiManager: GuiManager,
        objects: TestObject[]
    ) {
        this.Cesium = Cesium
        this.viewer = viewer
        this.gizmo = gizmo
        this.guiManager = guiManager
        
        this.container = document.createElement('div')
        this.container.style.cssText = `
            position: absolute;
            top: 70px;
            left: 16px;
            width: 220px;
            background: rgba(40, 40, 40, 0.9);
            border: 1px solid #444;
            max-height: calc(100vh - 100px);
            overflow-y: auto;
            border-radius: 4px;
            font-family: sans-serif;
            color: #eee;
            z-index: 100;
        `
        
        const header = document.createElement('div')
        header.textContent = '测试对象列表'
        header.style.cssText = `
            padding: 8px 12px;
            background: #333;
            border-bottom: 1px solid #444;
            font-weight: bold;
            font-size: 13px;
        `
        this.container.appendChild(header)
        
        const list = document.createElement('div')
        objects.forEach(obj => {
            const item = document.createElement('div')
            item.textContent = obj.name
            item.style.cssText = `
                padding: 8px 12px;
                cursor: pointer;
                border-bottom: 1px solid #333;
                font-size: 12px;
                transition: background 0.2s;
            `
            item.onmouseover = () => item.style.background = '#505050'
            item.onmouseout = () => item.style.background = 'transparent'
            item.onclick = () => this.selectObject(obj)
            list.appendChild(item)
        })
        this.container.appendChild(list)
        
        document.body.appendChild(this.container)
    }

    private selectObject(obj: TestObject) {
        // 1. Mount Gizmo
        if (obj.type === 'entity') {
            const entity = obj.object as CesiumType.Entity
            if (obj.name.includes('Box')) {
                // Dimensions are already attached to entity in TestLoader
                this.gizmo.mountToEntity(entity, this.viewer)
            } else {
                 this.gizmo.mountToEntity(entity, this.viewer)
            }
        } else if (obj.type === 'primitive') {
            this.gizmo.mountToPrimitive(obj.object)
        } else if (obj.type === 'model') {
            const model = obj.object as CesiumType.Model
            this.gizmo.mountToPrimitive(model)
        } else if (obj.type === 'tileset') {
            this.gizmo.mountToPrimitive(obj.object)
        }
        
        // 2. Fly To
        this.flyToObject(obj)
        
        // 3. Update GUI
        this.guiManager.updateCoordinates(this.gizmo._mountedPrimitive)
    }

    private flyToObject(obj: TestObject) {
        if (obj.type === 'entity') {
            this.viewer.flyTo(obj.object, { duration: 1.0 })
        } else if (obj.type === 'model') {
             const model = obj.object as CesiumType.Model
             const bs = model.boundingSphere
             if (bs) this.viewer.camera.flyToBoundingSphere(bs, { duration: 1.0 })
        } else if (obj.type === 'tileset') {
             const tileset = obj.object as CesiumType.Cesium3DTileset
             const bs = tileset.boundingSphere
             if (bs) this.viewer.camera.flyToBoundingSphere(bs, { duration: 1.0 })
        } else if (obj.type === 'primitive') {
             const p = obj.object as any
             let center: CesiumType.Cartesian3 | undefined

             if (p.position) {
                 // PointPrimitive
                 center = p.position
             } else if (p.modelMatrix) {
                 // Generic Primitive with modelMatrix
                 center = new this.Cesium.Cartesian3()
                 this.Cesium.Matrix4.getTranslation(p.modelMatrix, center)
             }

             if (center) {
                 // Create visual bounding sphere
                 const bs = new this.Cesium.BoundingSphere(center, 50)
                 this.viewer.camera.flyToBoundingSphere(bs, { duration: 1.0 })
             }
        }
    }
}
