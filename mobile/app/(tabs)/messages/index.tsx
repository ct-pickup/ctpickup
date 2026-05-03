import { Redirect } from "expo-router";
import { ANNOUNCEMENTS_CHAT_SLUG } from "@/lib/teamChat";

export default function MessagesIndex() {
  // Default entry for Messages tab → Announcements thread.
  return <Redirect href={{ pathname: "/(tabs)/messages/thread", params: { slug: ANNOUNCEMENTS_CHAT_SLUG } }} />;
}
