import Extract from "./Extract";
import Method from "./Method";

/** Data & method: the export tool for the technical jury, then how every number was obtained. */
export default function DataMethod() {
  return (
    <div className="datamethod">
      <Extract />
      <div className="dm-sep" id="method" />
      <Method />
      <p className="small faint" style={{ marginTop: 32 }}>
        The evidence graph can be opened in Obsidian: <a href="/api/kg/obsidian/export">download the vault (.zip)</a>.
      </p>
    </div>
  );
}
