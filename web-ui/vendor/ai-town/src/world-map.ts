import { bgtiles, mapheight, mapwidth, objmap, tilesetpxh, tilesetpxw, tiledim } from '../data/gentle.js'
import tileset from '../assets/gentle-obj.png'

export type WorldMap = {
  width: number
  height: number
  tileSetUrl: string
  tileSetDimX: number
  tileSetDimY: number
  tileDim: number
  bgTiles: number[][][]
  objectTiles: number[][][]
  animatedSprites: []
}

export const worldMap: WorldMap = {
  width: mapwidth,
  height: mapheight,
  tileSetUrl: tileset.src,
  tileSetDimX: tilesetpxw,
  tileSetDimY: tilesetpxh,
  tileDim: tiledim,
  bgTiles: bgtiles,
  objectTiles: objmap,
  animatedSprites: [],
}
