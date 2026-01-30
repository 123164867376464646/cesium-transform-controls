import type * as CesiumType from 'cesium'

export const TestConfigs = {
  baseLon: 106.58446188,
  baseLat: 29.57088337,
  baseHeight: 0,
}

// 网格布局配置
const GRID_CONFIG = {
  columns: 5,
  spacingLon: 0.002,
  spacingLat: 0.002,
}

/**
 * 获取网格位置
 * @param index 序号
 * @param rowOffset 行偏移（默认为0，即第一行）
 */
function getGridPosition(index: number, rowOffset: number = 0) {
  const { baseLon, baseLat } = TestConfigs
  const { columns, spacingLon, spacingLat } = GRID_CONFIG

  const row = Math.floor(index / columns) + rowOffset
  const col = index % columns

  // 使列居中：col - (columns - 1) / 2
  const centerColOffset = col - (columns - 1) / 2

  return {
    lon: baseLon + centerColOffset * spacingLon,
    // 纬度向下排列（行号增加，纬度减小）
    // 为了避开中心模型（假设模型在(0,0)且占据一定空间），第一行位置向下偏移
    lat: baseLat - (row + 1) * spacingLat 
  }
}

// Return type for list registration
export interface TestObject {
    name: string
    object: any
    type: 'entity' | 'primitive' | 'model' | 'tileset'
}

export async function loadTestModel(Cesium: typeof CesiumType, viewer: CesiumType.Viewer): Promise<TestObject> {
  const { baseLon, baseLat, baseHeight } = TestConfigs
  
  // 模型位于中心
  const model = await Cesium.Model.fromGltfAsync({
    url: './luaz.glb',
    modelMatrix: Cesium.Transforms.headingPitchRollToFixedFrame(
      Cesium.Cartesian3.fromDegrees(baseLon, baseLat, baseHeight),
      new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(0), Cesium.Math.toRadians(0), Cesium.Math.toRadians(0)),
    ),
    scale: 10,
  })
  viewer.scene.primitives.add(model)
  return { name: 'Luaz Car (Model)', object: model, type: 'model' }
}

export function loadTestEntities(Cesium: typeof CesiumType, viewer: CesiumType.Viewer): TestObject[] {
  const { baseHeight } = TestConfigs
  const list: TestObject[] = []
  let index = 0

  // 1. Point
  const p0 = getGridPosition(index++)
  const point = viewer.entities.add({
    name: 'Entity: Point',
    position: Cesium.Cartesian3.fromDegrees(p0.lon, p0.lat, baseHeight + 10),
    point: { pixelSize: 10, color: Cesium.Color.RED },
  })
  list.push({ name: 'Point', object: point, type: 'entity' })

  // 2. Billboard
  const p1 = getGridPosition(index++)
  const billboard = viewer.entities.add({
    name: 'Entity: Billboard',
    position: Cesium.Cartesian3.fromDegrees(p1.lon, p1.lat, baseHeight + 10),
    billboard: {
      image: `https://api.dicebear.com/9.x/icons/svg?seed=${Math.floor(Math.random() * 10000)}`, // 甚至可以用Canvas绘制
      scale: 0.5,
    },
  })
  list.push({ name: 'Billboard', object: billboard, type: 'entity' })

  // 3. Label
  const p2 = getGridPosition(index++)
  const label = viewer.entities.add({
    name: 'Entity: Label',
    position: Cesium.Cartesian3.fromDegrees(p2.lon, p2.lat, baseHeight + 10),
    label: {
      text: 'Cesium Label',
      font: '20px sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
    },
  })
  list.push({ name: 'Label', object: label, type: 'entity' })

  // 4. Box
  const p3 = getGridPosition(index++)
  const boxDimensions = new Cesium.Cartesian3(20.0, 12.0, 10.0)
  const box = viewer.entities.add({
    name: 'Entity: Box',
    position: Cesium.Cartesian3.fromDegrees(p3.lon, p3.lat, baseHeight + 10),
    box: {
      dimensions: boxDimensions,
      material: Cesium.Color.ORANGE.withAlpha(0.6),
      outline: true,
      outlineColor: Cesium.Color.BLACK,
    },
  })
  ;(box as any)._gizmoDimensionsRef = boxDimensions
  list.push({ name: 'Box', object: box, type: 'entity' })

  // 5. Cylinder
  const p4 = getGridPosition(index++)
  const cylinder = viewer.entities.add({
    name: 'Entity: Cylinder',
    position: Cesium.Cartesian3.fromDegrees(p4.lon, p4.lat, baseHeight + 10),
    cylinder: {
      length: 20.0,
      topRadius: 5.0,
      bottomRadius: 10.0,
      material: Cesium.Color.GREEN.withAlpha(0.6),
      outline: true,
    },
  })
  list.push({ name: 'Cylinder', object: cylinder, type: 'entity' })

  // 6. Ellipsoid (Sphere)
  const p5 = getGridPosition(index++)
  const ellipsoid = viewer.entities.add({
    name: 'Entity: Ellipsoid',
    position: Cesium.Cartesian3.fromDegrees(p5.lon, p5.lat, baseHeight + 15),
    ellipsoid: {
      radii: new Cesium.Cartesian3(10.0, 8.0, 8.0),
      material: Cesium.Color.BLUE.withAlpha(0.6),
      outline: true,
    },
  })
  list.push({ name: 'Ellipsoid', object: ellipsoid, type: 'entity' })

  // 7. Model (Entity)
  const p6 = getGridPosition(index++)
  const modelEntity = viewer.entities.add({
    name: 'Entity: Model',
    position: Cesium.Cartesian3.fromDegrees(p6.lon, p6.lat, baseHeight),
    model: {
      uri: './luaz.glb',
      minimumPixelSize: 64,
      maximumScale: 20000,
      scale: 5,
    },
  })
  list.push({ name: 'Model (Entity)', object: modelEntity, type: 'entity' })

  // 8. Rectangle
  const p7 = getGridPosition(index++)
  const rectSize = 0.00015
  const rectangle = viewer.entities.add({
    name: 'Entity: Rectangle',
    rectangle: {
      coordinates: Cesium.Rectangle.fromDegrees(
        p7.lon - rectSize, p7.lat - rectSize,
        p7.lon + rectSize, p7.lat + rectSize
      ),
      material: Cesium.Color.PURPLE.withAlpha(0.6),
      outline: true,
      height: baseHeight,
      extrudedHeight:20
    },
  })
  // 矩形通常没有单一的position属性供Gizmo使用，除非Gizmo能计算中心
  list.push({ name: 'Rectangle', object: rectangle, type: 'entity' })

  // 9. Wall
  const p8 = getGridPosition(index++)
  const wallSize = 0.00015
  const wall = viewer.entities.add({
    name: 'Entity: Wall',
    wall: {
      positions: Cesium.Cartesian3.fromDegreesArrayHeights([
        p8.lon - wallSize, p8.lat - wallSize, 20.0,
        p8.lon + wallSize, p8.lat - wallSize, 20.0,
        p8.lon + wallSize, p8.lat + wallSize, 20.0,
        p8.lon - wallSize, p8.lat + wallSize, 20.0,
        p8.lon - wallSize, p8.lat - wallSize, 20.0,
      ]),
      material: Cesium.Color.BROWN.withAlpha(0.6),
      outline: true,
    },
  })
  list.push({ name: 'Wall', object: wall, type: 'entity' })

  // 10. Ellipse (Circle)
  const p9 = getGridPosition(index++)
  const ellipse = viewer.entities.add({
    name: 'Entity: Ellipse',
    position: Cesium.Cartesian3.fromDegrees(p9.lon, p9.lat, baseHeight),
    ellipse: {
      semiMinorAxis: 15.0,
      semiMajorAxis: 15.0, // Circle
      material: Cesium.Color.MAGENTA.withAlpha(0.6),
      outline: true,
      extrudedHeight: 50,
      height: baseHeight,
    },
  })
  list.push({ name: 'Ellipse', object: ellipse, type: 'entity' })

  // 11. Polygon (Existing)
  const p10 = getGridPosition(index++)
  const polySize = 0.00015
  const polygon = viewer.entities.add({
    name: 'Entity: Polygon',
    polygon: {
      hierarchy: Cesium.Cartesian3.fromDegreesArray([
        p10.lon - polySize, p10.lat - polySize,
        p10.lon + polySize * 1.5, p10.lat - polySize,
        p10.lon + polySize * 1.5, p10.lat + polySize * 1.5,
        p10.lon - polySize, p10.lat + polySize * 1.5,
      ]),
      material: Cesium.Color.YELLOW.withAlpha(0.35),
      outline: true,
      outlineColor: Cesium.Color.YELLOW,
      height: 0,
      extrudedHeight: 20,
    },
  })
  list.push({ name: 'Polygon', object: polygon, type: 'entity' })

  // 12. Polyline (Existing)
  const p11 = getGridPosition(index++)
  const lineSize = 0.00015
  const polyline = viewer.entities.add({
    name: 'Entity: Polyline',
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArray([
        p11.lon - lineSize, p11.lat,
        p11.lon, p11.lat + lineSize,
        p11.lon + lineSize, p11.lat,
      ]),
      width: 4,
      material: Cesium.Color.CYAN,
    },
  })
  list.push({ name: 'Polyline', object: polyline, type: 'entity' })

   // 13. Corridor
   const p12 = getGridPosition(index++)
   const corrSize = 0.00015
   const corridor = viewer.entities.add({
     name: 'Entity: Corridor',
     corridor: {
       positions: Cesium.Cartesian3.fromDegreesArray([
         p12.lon - corrSize, p12.lat - corrSize,
         p12.lon + corrSize, p12.lat - corrSize,
         p12.lon + corrSize, p12.lat + corrSize
       ]),
       width: 15.0,
       material: Cesium.Color.SILVER.withAlpha(0.6),
       outline: true,
       extrudedHeight: 10,
       height: baseHeight,
     }
   })
   console.log(corridor);
   
   list.push({ name: 'Corridor', object: corridor, type: 'entity' })

  return list
}

export function loadTestPrimitives(Cesium: typeof CesiumType, viewer: CesiumType.Viewer): TestObject[] {
  const { baseHeight } = TestConfigs
  const list: TestObject[] = []
  
  // Primitives 接 Entity 之后排列 (Row Offset 4)
  let index = 0
  const rowOffset = 4

  // Primitive 1: Magenta Box
  const p0 = getGridPosition(index++, rowOffset)
  const position1 = Cesium.Cartesian3.fromDegrees(p0.lon, p0.lat, baseHeight + 10)
  const modelMatrix1 = Cesium.Transforms.eastNorthUpToFixedFrame(position1)

  const primitive1 = new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: Cesium.BoxGeometry.fromDimensions({
        dimensions: new Cesium.Cartesian3(15.0, 15.0, 15.0),
        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
      }),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.MAGENTA),
      },
    }),
    appearance: new Cesium.PerInstanceColorAppearance({
      flat: true,
    }),
    asynchronous: false,
  })
  primitive1.modelMatrix = modelMatrix1
  viewer.scene.primitives.add(primitive1)
  list.push({ name: 'Primitive: Box 1', object: primitive1, type: 'primitive' })

  // Primitive 2: Lime Box
  const p1 = getGridPosition(index++, rowOffset)
  const position2 = Cesium.Cartesian3.fromDegrees(p1.lon, p1.lat, baseHeight + 10)
  const modelMatrix2 = Cesium.Transforms.eastNorthUpToFixedFrame(position2)

  const primitive2 = new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: Cesium.BoxGeometry.fromDimensions({
        dimensions: new Cesium.Cartesian3(12.0, 12.0, 12.0),
        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
      }),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.LIME),
      },
    }),
    appearance: new Cesium.PerInstanceColorAppearance({
      flat: true,
    }),
    asynchronous: false,
  })
  primitive2.modelMatrix = modelMatrix2
  viewer.scene.primitives.add(primitive2)
  list.push({ name: 'Primitive: Box 2', object: primitive2, type: 'primitive' })
  
  return list
}

export async function load3DTileset(Cesium: typeof CesiumType, viewer: CesiumType.Viewer): Promise<TestObject> {
  const tileset = await Cesium.Cesium3DTileset.fromUrl(
    'https://raw.githubusercontent.com/CesiumGS/3d-tiles-samples/main/1.1/MetadataGranularities/tileset.json'
  )
  viewer.scene.primitives.add(tileset)
  
  // 调整位置 (Row Offset 5)
  const p0 = getGridPosition(0, 5)
  const position = Cesium.Cartesian3.fromDegrees(p0.lon, p0.lat, 0)
  const mat = Cesium.Transforms.eastNorthUpToFixedFrame(position)
  tileset.modelMatrix = mat
  
  return { name: '3D Tileset', object: tileset, type: 'tileset' }
}
