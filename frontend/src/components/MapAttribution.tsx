/**
 * Mapbox and OpenStreetMap, credited once under a list of static maps.
 *
 * The images themselves are requested with `logo=false` and `attribution=false`,
 * because on a 240px card the credit covers the route. Mapbox's terms allow moving it
 * out of the image provided it is still on the page, so every list that shows those
 * images has to render this.
 */
export function MapAttribution() {
  return (
    <p className="text-muted-foreground text-right text-xs">
      <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noreferrer">
        © Mapbox
      </a>{" "}
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
        © OpenStreetMap
      </a>
    </p>
  );
}
