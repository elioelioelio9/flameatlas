import Drawer from "./components/Drawer";
import { Layout } from "./components/Shell";
import { ErrorBox } from "./components/ui";
import { useApp } from "./state";
import Compare from "./views/Compare";
import ConditionsMap from "./views/ConditionsMap";
import Earth from "./views/Earth";
import Extract from "./views/Extract";
import FireLab from "./views/FireLab";
import Knowledge from "./views/Knowledge";
import MissionControl from "./views/MissionControl";
import FindEvidence from "./views/FindEvidence";
import Insights from "./views/Insights";
import Method from "./views/Method";
import Overview from "./views/Overview";

export default function App() {
  const { route, loadError } = useApp();
  return (
    <Layout>
      {loadError && <ErrorBox error={loadError} />}
      {route === "mission" && <MissionControl />}
      {route === "firelab" && <FireLab />}
      {route === "knowledge" && <Knowledge />}
      {route === "overview" && <Overview />}
      {route === "find" && <FindEvidence />}
      {route === "map" && <ConditionsMap />}
      {route === "compare" && <Compare />}
      {route === "extract" && <Extract />}
      {route === "insights" && <Insights />}
      {route === "earth" && <Earth />}
      {route === "method" && <Method />}
      <Drawer />
    </Layout>
  );
}
