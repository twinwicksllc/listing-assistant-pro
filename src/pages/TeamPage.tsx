import { useState, useEffect } from "react";
import { ArrowLeft, Users, UserPlus, Mail, Crown, User, Trash2, Loader2, Check, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import BottomNav from "@/components/BottomNav";
import teckstartLogo from "@/assets/teckstart-logo.png";

interface OrgMember {
  id: string;
  user_id: string;
  role: string;
  profile?: { display_name: string | null; avatar_url: string | null } | null;
  email?: string;
}

interface Invitation {
  id: string;
  email: string;
  status: string;
  created_at: string;
}

interface PendingInvite {
  id: string;
  org_id: string;
  org_name?: string;
}

export default function TeamPage() {
  const navigate = useNavigate();
  const { user, org, isOwner, refreshOrg } = useAuth();
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!org.orgId) {
      setLoading(false);
      return;
    }
    loadTeam();
    loadPendingInvites();
  }, [org.orgId]);

  const loadTeam = async () => {
    if (!org.orgId) return;
    setLoading(true);

    // Fetch members
    const { data: memberData } = await supabase
      .from("org_members")
      .select("id, user_id, role")
      .eq("org_id", org.orgId);

    if (memberData) {
      // Fetch profiles for each member
      const memberIds = memberData.map((m) => m.user_id);
      const { data: profileData } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", memberIds);

      const profileMap = new Map(profileData?.map((p) => [p.id, p]) || []);

      // For the current user, use their auth email as fallback display name
      setMembers(
        memberData.map((m) => {
          const profile = profileMap.get(m.user_id) || null;
          // If this is the current user and display_name is null, use email prefix
          const fallbackName = m.user_id === user?.id
            ? (user.email ? user.email.split("@")[0] : null)
            : null;
          return {
            ...m,
            profile: profile
              ? { ...profile, display_name: profile.display_name || fallbackName }
              : { display_name: fallbackName, avatar_url: null },
            email: m.user_id === user?.id ? user.email : undefined,
          };
        })
      );
    }

    // Fetch invitations (owner only)
    if (isOwner) {
      const { data: invData } = await supabase
        .from("org_invitations")
        .select("*")
        .eq("org_id", org.orgId)
        .eq("status", "pending");
      setInvitations(invData || []);
    }

    setLoading(false);
  };

  const loadPendingInvites = async () => {
    if (!user?.email) return;
    const { data } = await supabase
      .from("org_invitations")
      .select("id, org_id")
      .eq("email", user.email)
      .eq("status", "pending");

    if (data && data.length > 0) {
      // Get org names
      const orgIds = data.map((d) => d.org_id);
      const { data: orgData } = await supabase
        .from("organizations")
        .select("id, name")
        .in("id", orgIds);
      const orgMap = new Map(orgData?.map((o) => [o.id, o.name]) || []);

      setPendingInvites(
        data.map((d) => ({
          ...d,
          org_name: orgMap.get(d.org_id) || "Unknown Team",
        }))
      );
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !org.orgId || !user) return;
    setSending(true);
    try {
      const { error } = await supabase.from("org_invitations").insert({
        org_id: org.orgId,
        email: inviteEmail.trim().toLowerCase(),
        invited_by: user.id,
      });

      if (error) {
        if (error.code === "23505") {
          toast.error("This email has already been invited");
        } else {
          throw error;
        }
      } else {
        toast.success(`Invitation sent to ${inviteEmail}`);
        setInviteEmail("");
        loadTeam();
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to send invitation");
    } finally {
      setSending(false);
    }
  };

  const handleAcceptInvite = async (inviteId: string) => {
    try {
      const { error } = await supabase.rpc("accept_invitation", {
        _invitation_id: inviteId,
      });
      if (error) throw error;
      toast.success("Invitation accepted! You've joined the team.");
      await refreshOrg();
      setPendingInvites((prev) => prev.filter((i) => i.id !== inviteId));
      loadTeam();
    } catch (err: any) {
      toast.error(err.message || "Failed to accept invitation");
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    const { error } = await supabase.from("org_members").delete().eq("id", memberId);
    if (error) {
      toast.error("Failed to remove member");
    } else {
      toast.success("Member removed");
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
    }
  };

  const handleCancelInvite = async (inviteId: string) => {
    const { error } = await supabase.from("org_invitations").delete().eq("id", inviteId);
    if (error) {
      toast.error("Failed to cancel invitation");
    } else {
      setInvitations((prev) => prev.filter((i) => i.id !== inviteId));
      toast.success("Invitation canceled");
    }
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="px-5 pt-12 pb-4 md:px-8 lg:px-12">
        <div className="max-w-3xl mx-auto flex items-center gap-2">
          <button onClick={() => navigate("/home")} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <img src={teckstartLogo} alt="Teckstart" className="h-12 w-auto" />
          <div>
            <h1 className="text-lg font-bold text-foreground">Team</h1>
            <p className="text-xs text-muted-foreground">{org.orgName || "Your Organization"}</p>
          </div>
        </div>
      </header>

      <div className="px-5 md:px-8 lg:px-12 max-w-3xl mx-auto space-y-6">
        {/* Pending invitations for current user */}
        {pendingInvites.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">Pending Invitations</h2>
            {pendingInvites.map((invite) => (
              <div key={invite.id} className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Join {invite.org_name}</p>
                  <p className="text-xs text-muted-foreground">You've been invited as a Lister</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAcceptInvite(invite.id)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium"
                  >
                    <Check className="w-3 h-3" /> Accept
                  </button>
                  <button
                    onClick={() => setPendingInvites((prev) => prev.filter((i) => i.id !== invite.id))}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-secondary text-foreground text-xs font-medium"
                  >
                    <X className="w-3 h-3" /> Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Your role */}
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isOwner ? "bg-primary/10" : "bg-secondary"}`}>
            {isOwner ? <Crown className="w-5 h-5 text-primary" /> : <User className="w-5 h-5 text-muted-foreground" />}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{isOwner ? "Account Owner" : "Lister"}</p>
            <p className="text-xs text-muted-foreground">
              {isOwner
                ? "Full access: publish, dashboard, billing, and team management"
                : "Can capture items and create drafts. Publishing and dashboard are managed by the account owner."}
            </p>
          </div>
        </div>

        {/* Members list */}
        <div className="space-y-3">
          <div className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Team Members</h2>
            <span className="ml-auto text-xs text-muted-foreground">{members.length} member{members.length !== 1 ? "s" : ""}</span>
          </div>

          {loading ? (
            <div className="text-center py-8">
              <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-2">
              {members.map((member) => (
                <div key={member.id} className="bg-card border border-border rounded-xl p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-muted-foreground">
                    {(member.profile?.display_name || member.email || "?")[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {member.profile?.display_name || member.email || "Unknown"}
                    </p>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      member.role === "owner" ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"
                    }`}>
                      {member.role === "owner" ? "Owner" : "Lister"}
                    </span>
                  </div>
                  {isOwner && member.role !== "owner" && member.user_id !== user?.id && (
                    <button
                      onClick={() => handleRemoveMember(member.id)}
                      className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Invite section (owner only) */}
        {isOwner && (
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <UserPlus className="w-3.5 h-3.5 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Invite a Lister</h2>
            </div>

            <div className="flex gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="email@example.com"
                className="flex-1 bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                onKeyDown={(e) => e.key === "Enter" && handleInvite()}
              />
              <button
                onClick={handleInvite}
                disabled={sending || !inviteEmail.trim()}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                Invite
              </button>
            </div>

            {/* Pending invitations */}
            {invitations.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Pending Invitations</p>
                {invitations.map((inv) => (
                  <div key={inv.id} className="bg-card border border-border rounded-lg px-3 py-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-xs text-foreground">{inv.email}</span>
                    </div>
                    <button
                      onClick={() => handleCancelInvite(inv.id)}
                      className="text-xs text-destructive hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
