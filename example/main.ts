import * as Cesium from 'cesium'
import { Gizmo } from 'cesium-transform-controls'
import { setupScene } from './modules/SceneSetup'
import { loadTestEntities, loadTestModel, loadTestPrimitives, load3DTileset, type TestObject } from './modules/TestLoader'
import { setupGizmo } from './modules/GizmoSetup'
import { GuiManager } from './modules/GuiManager'
import { ObjectList } from './modules/ObjectList'

// Global export for debug
declare global {
  interface Window {
    Cesium: any
    viewer: any
    model: any
    gizmo: any
    CesiumTransformControls: any
  }
}

const viewer = setupScene(Cesium, 'cesiumContainer')

async function init() {
    const entities = loadTestEntities(Cesium, viewer)
    const primitives = loadTestPrimitives(Cesium, viewer)
    
    const modelObj = await loadTestModel(Cesium, viewer)
    const tilesetObj = await load3DTileset(Cesium, viewer)
    
    const allObjects: TestObject[] = [
        modelObj,
        ...entities,
        ...primitives,
        tilesetObj
    ]

    // Setup Gizmo
    const gizmo = setupGizmo(Gizmo, viewer, {
        onMove: () => guiManager.updateCoordinates(gizmo._mountedPrimitive)
    })
    window.model = modelObj.object
    window.gizmo = gizmo

    // Setup GUI
    const guiManager = new GuiManager(Cesium, gizmo, viewer)

    // Setup Object List UI
    new ObjectList(Cesium, viewer, gizmo, guiManager, allObjects)

    // Default: Mount to Model Node
    const model = modelObj.object
    model.readyEvent.addEventListener(() => {
        const nodeName = 'door_R_luaz_diffuse_0'
        const node = model.getNode(nodeName)
        gizmo.mountToNode(node, model, viewer)
        guiManager.updateCoordinates(gizmo._mountedPrimitive)
        
        // Initial FlyTo
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
        }, 500)
    })
    
    // Exports
    window.Cesium = Cesium
    window.viewer = viewer
}

init().catch(console.error)
