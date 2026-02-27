declare module '@mapbox/polyline' {
  export function decode(str: string, precision?: number): Array<[number, number]>
  export function encode(coordinates: Array<[number, number]>, precision?: number): string
  export function fromGeoJSON(geojson: unknown, precision?: number): string
  export function toGeoJSON(str: string, precision?: number): unknown
}
