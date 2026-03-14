import { ProfilePublicPage } from "@/components/ProfilePublicPage";

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const resolvedParams = await params;
  return <ProfilePublicPage username={resolvedParams.username} />;
}
