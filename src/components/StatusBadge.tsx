import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Home,
  MinusCircle,
  XCircle,
} from 'lucide-react';

export function StatusIndicator({ status }: { status: string }) {
  switch (status) {
    case 'Present':
    case 'Approved':
    case 'active':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#16A34A] dark:text-emerald-400 whitespace-nowrap">
          <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span>{status === 'active' ? 'Active' : status}</span>
        </span>
      );
    case 'Late':
    case 'Pending':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#D97706] dark:text-amber-400 whitespace-nowrap">
          <Clock aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span>{status}</span>
        </span>
      );
    case 'Half Day':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#D97706] dark:text-amber-400 whitespace-nowrap">
          <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span>{status}</span>
        </span>
      );
    case 'Work From Home':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#2563EB] dark:text-blue-400 whitespace-nowrap">
          <Home aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span>Work From Home</span>
        </span>
      );
    case 'On Leave':
    case 'Holiday':
    case 'Weekly Off':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap">
          <Calendar aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span>{status}</span>
        </span>
      );
    case 'Absent':
    case 'Rejected':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#DC2626] dark:text-rose-400 whitespace-nowrap">
          <XCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span>{status}</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
          <MinusCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span>{status === 'inactive' ? 'Inactive' : status}</span>
        </span>
      );
  }
}
