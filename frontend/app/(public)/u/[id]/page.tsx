"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, User } from "@/lib/api";
import { CheckCircle2 } from "lucide-react";
import { T } from "@/components/T";
import { Avatar } from "@/components/ui/Avatar";
import { LangMenu } from "@/components/LangMenu";
import { Logo } from "@/components/Logo";

export default function PublicProfile() {
  const { id } = useParams<{ id: string }>();
  const [u, setU] = useState<User | null>(null);
  useEffect(() => {
    api.get<User>(`/api/users/${id}`, { auth: "none" } as any).then(setU);
  }, [id]);
  if (!u) return <div className="p-6">Yuklanmoqda…</div>;
  return (
    <div className="min-h-screen p-4 mx-auto max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <Logo />
        <LangMenu />
      </div>
      <div className="card p-6 flex gap-4">
        <Avatar name={`${u.firstName} ${u.lastName}`} src={u.avatarUrl || undefined} size="xl" />
        <div className="flex-1">
          <h1 className="text-xl font-bold">{u.firstName} {u.lastName} {u.isPhoneVerified && <CheckCircle2 size={16} className="inline text-success" />}</h1>
          <div className="text-sm text-[color:var(--text-muted)] mt-1">
            {u.region}{u.district ? `, ${u.district}` : ""}
            {" "}• {u.completedJobsCount} <T>bajarilgan ish</T>
          </div>
          {u.skills && u.skills.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {u.skills.map((s, i) => <span key={i} className="chip">{s}</span>)}
            </div>
          )}
          {u.bio && <p className="mt-3 text-sm">{u.bio}</p>}
        </div>
      </div>
    </div>
  );
}
