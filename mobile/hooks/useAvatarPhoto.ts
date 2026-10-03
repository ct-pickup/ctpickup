import * as ImagePicker from "expo-image-picker";
import { useCallback, useState } from "react";
import { Alert } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useProfilePhoto } from "@/context/ProfilePhotoContext";
import { reportPhotoUploadError } from "@/lib/reportPhotoUploadError";
import { PhotoUploadError } from "@shared/photoUploadError";

/** Profile photo state plus the Take / Choose / Remove picker that uploads to the avatars bucket. */
export function useAvatarPhoto() {
  const { supabase, session } = useAuth();
  const { setAvatarUrl: setSharedAvatarUrl } = useProfilePhoto();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const uploadAvatarUri = useCallback(
    async (uri: string, userId: string, prevAvatarUrl: string | null) => {
      setAvatarUploading(true);
      setAvatarUrl(uri);
      const path = `${userId}/avatar.jpg`;
      try {
        const response = await fetch(uri);
        const arrayBuffer = await response.arrayBuffer();
        const { error: uploadError } = await supabase!.storage
          .from("avatars")
          .upload(path, arrayBuffer, { contentType: "image/jpeg", upsert: true });
        if (uploadError) {
          const status = (uploadError as { statusCode?: string | number }).statusCode;
          throw new PhotoUploadError(uploadError.message, { status: status == null ? undefined : Number(status) });
        }
        const { data: urlData } = supabase!.storage.from("avatars").getPublicUrl(path);
        const publicUrl = urlData.publicUrl + `?t=${Date.now()}`;
        const { error: updateError } = await supabase!.from("profiles").update({ avatar_url: publicUrl }).eq("id", userId);
        if (updateError) {
          setAvatarUrl(prevAvatarUrl);
          Alert.alert("Photo not saved", reportPhotoUploadError(updateError, { stage: "save", bucket: "avatars", path }));
          return;
        }
        setAvatarUrl(publicUrl);
        setSharedAvatarUrl(publicUrl);
      } catch (e) {
        setAvatarUrl(prevAvatarUrl);
        Alert.alert("Photo not uploaded", reportPhotoUploadError(e, { stage: "upload", bucket: "avatars", path }));
      } finally {
        setAvatarUploading(false);
      }
    },
    [supabase, setSharedAvatarUrl],
  );

  const pickAndUploadAvatar = useCallback(() => {
    if (!supabase || !session?.user?.id) return;
    const userId = session.user.id;
    const prevAvatarUrl = avatarUrl;

    Alert.alert("Profile Photo", undefined, [
      {
        text: "Take Photo",
        onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== "granted") {
            Alert.alert("Permission required", "Camera access is needed to take a photo.");
            return;
          }
          const result = await ImagePicker.launchCameraAsync({
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.8,
          });
          if (!result.canceled && result.assets?.[0]) {
            await uploadAvatarUri(result.assets[0].uri, userId, prevAvatarUrl);
          }
        },
      },
      {
        text: "Choose from Library",
        onPress: async () => {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== "granted") {
            Alert.alert("Permission required", "Photo library access is needed to choose a photo.");
            return;
          }
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.8,
          });
          if (!result.canceled && result.assets?.[0]) {
            await uploadAvatarUri(result.assets[0].uri, userId, prevAvatarUrl);
          }
        },
      },
      {
        text: "Remove Photo",
        style: "destructive",
        onPress: async () => {
          setAvatarUrl(null);
          setSharedAvatarUrl(null);
          try {
            await supabase.from("profiles").update({ avatar_url: null }).eq("id", userId);
          } catch {
            // ignore — optimistic clear already applied
          }
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [supabase, session?.user?.id, avatarUrl, uploadAvatarUri, setSharedAvatarUrl]);

  return { avatarUrl, setAvatarUrl, avatarUploading, pickAndUploadAvatar };
}
