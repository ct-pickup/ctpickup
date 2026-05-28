import { Redirect } from "expo-router";

/** Admin tab opens the admin stack menu at /admin. */
export default function AdminTabScreen() {
  return <Redirect href="/admin" />;
}
