import { Link } from "react-router-dom";

export default function LegalFooter() {
  return (
    <footer className="border-t border-border bg-background py-6 px-5">
      <div className="max-w-2xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>&copy; {new Date().getFullYear()} Teckstart. All rights reserved.</span>
        <div className="flex items-center gap-4">
          <Link to="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
          <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
        </div>
      </div>
    </footer>
  );
}
