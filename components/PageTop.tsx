import Link from "next/link";
import SideMenu from "@/components/SideMenu";

export default function PageTop({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-6xl px-6 pt-6">
      <div className="rounded-full bg-white/90 px-6 py-3 text-black flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-sm font-medium tracking-wide hover:underline underline-offset-4"
          >
            Home
          </Link>
          <div className="font-semibold tracking-wide uppercase">{title}</div>
        </div>
        <SideMenu />
      </div>
    </div>
  );
}
