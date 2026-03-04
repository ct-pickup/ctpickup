import AccountMenu from "@/components/AccountMenu";

export default function Topbar() {
  return (
    <div className="ct-topbar-wrap">
      <div className="ct-sticker">
        <div className="ct-brand">CT PICKUP</div>

        <div className="ct-sticker-right">
          <nav className="ct-nav">
            <a href="/status">Status</a>
            <a href="/help">Help</a>
          </nav>
          <AccountMenu />
        </div>
      </div>
    </div>
  );
}
