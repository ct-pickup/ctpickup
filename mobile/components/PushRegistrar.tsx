import { useAuth } from "@/context/AuthContext";
import { usePushRegistration } from "@/hooks/usePushRegistration";

export function PushRegistrar() {
  const { session } = useAuth();
  usePushRegistration(session?.access_token ?? null);
  return null;
}
