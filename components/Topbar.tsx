import AccountMenu from "@/components/AccountMenu";

export default function Topbar() {
  return (
    <div className="ct-topbar">
      <div className="ct-brand">CT PICKUP</div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div className="ct-nav">
          <a href="/status">Status</a>
          <a href="/help">Help</a>
        </div>
        <AccountMenu />
      </div>
    </div>
  );
}
