/** Images imported by the renderer resolve to their bundled URL. */
declare module '*.png' {
  const url: string;
  export default url;
}
