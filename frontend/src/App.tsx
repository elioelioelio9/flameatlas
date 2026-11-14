import Drawer from "./components/Drawer";
import { Layout } from "./components/Shell";
import { ErrorBox } from "./components/ui";
import { useApp } from "./state";
import DataMethod from "./views/DataMethod";
import Evidence from "./views/Evidence";
import FireLab from "./views/FireLab";
import MissionControl from "./views/MissionControl";

export default function App() {
  const { route, loadError } = useApp();
  return (
    <Layout>
      {loadError && route !== "mission" && route !== "firelab" && <ErrorBox error={loadError} />}
      {route === "mission" && <MissionControl />}
      {route === "firelab" && <FireLab />}
      {route === "evidence" && <Evidence />}
      {route === "data" && <DataMethod />}
      <Drawer />
    </Layout>
  );
}
