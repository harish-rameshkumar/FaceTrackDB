// Small inline icons. They are always decorative (aria-hidden): the meaning is also written as text.
type P = { className?: string };
const base = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: false } as const;

export const CheckIcon = ({ className }: P) => (<svg {...base} className={className}><path d="M3 8.5l3.2 3.2L13 4.8" /></svg>);
export const CrossIcon = ({ className }: P) => (<svg {...base} className={className}><path d="M4 4l8 8M12 4l-8 8" /></svg>);
export const ClockIcon = ({ className }: P) => (<svg {...base} className={className}><circle cx="8" cy="8" r="6" /><path d="M8 4.8V8l2.2 1.4" /></svg>);
export const AlertIcon = ({ className }: P) => (<svg {...base} className={className}><path d="M8 2.2l6 10.6H2z" /><path d="M8 6.6v2.8M8 11.4v.1" /></svg>);
export const InfoIcon = ({ className }: P) => (<svg {...base} className={className}><circle cx="8" cy="8" r="6" /><path d="M8 7.2v3.4M8 5v.1" /></svg>);
export const EyeIcon = ({ className }: P) => (<svg {...base} className={className}><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></svg>);
export const EyeOffIcon = ({ className }: P) => (<svg {...base} className={className}><path d="M2 2l12 12" /><path d="M6.4 4a6.6 6.6 0 011.6-.5c4 0 6.5 4.5 6.5 4.5a11 11 0 01-2 2.5M4 5.6A11 11 0 001.5 8S4 12.5 8 12.5c.9 0 1.7-.2 2.4-.5" /></svg>);
export const MenuIcon = ({ className }: P) => (<svg {...base} className={className}><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" /></svg>);
export const InboxIcon = ({ className }: P) => (<svg {...base} width={28} height={28} className={className}><path d="M2 9l2-6h8l2 6v4H2z" /><path d="M2 9h3.5l1 1.5h3L11 9h3" /></svg>);
export const DotIcon = ({ className }: P) => (<svg {...base} className={className}><circle cx="8" cy="8" r="3" /></svg>);
