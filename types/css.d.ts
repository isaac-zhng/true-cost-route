// Allows TypeScript to import CSS files (used by maplibre-gl and mapbox-gl)
declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}

// Specific CSS side-effect imports used in the project
declare module 'maplibre-gl/dist/maplibre-gl.css' {}
declare module 'mapbox-gl/dist/mapbox-gl.css' {}
