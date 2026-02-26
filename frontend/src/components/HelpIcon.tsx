import { Link } from "react-router-dom";

export default function HelpIcon({ section }: { section: string }) {
  return (
    <Link
      to={`/help#${section}`}
      title="Help"
      className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-100 text-gray-500 text-xs font-bold hover:bg-indigo-100 hover:text-indigo-600 transition-colors"
    >
      ?
    </Link>
  );
}
