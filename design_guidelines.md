{
  "brand": {
    "name": "CVF PT",
    "business": "Core Value Fitness (Albuquerque, NM)",
    "tagline": "Fitness Done Right",
    "attributes": [
      "athletic",
      "clean",
      "fast",
      "high-contrast",
      "coach-first mobile workflows",
      "trustworthy (payments/waivers)",
      "not corporate"
    ]
  },
  "visual_personality": {
    "style_fusion": [
      "Swiss-style hierarchy (tight type scale + strong grid)",
      "Bento-card dashboard (quick scanning)",
      "Gym-floor utilitarian UI (big touch targets, minimal steps)",
      "Subtle glass/shine accents ONLY on primary CTA (not gradients everywhere)"
    ],
    "dark_theme_only": true,
    "legibility_in_bright_gyms": {
      "rule": "Prefer near-black matte surfaces + high-luminance teal accents; avoid low-contrast gray-on-gray.",
      "min_touch_target": "44px",
      "default_density": "comfortable (2–3x more spacing than typical admin tools)"
    }
  },
  "typography": {
    "google_fonts": {
      "display": {
        "family": "Space Grotesk",
        "weights": ["500", "600", "700"],
        "usage": "Headings, stat numbers, tab labels"
      },
      "body": {
        "family": "Figtree",
        "weights": ["400", "500", "600"],
        "usage": "Body, forms, tables, long notes"
      }
    },
    "tailwind_font_setup": {
      "instruction": "Add Google Fonts <link> in index.html and set Tailwind fontFamily in tailwind.config.js (or use CSS variables in index.css).",
      "css_vars": {
        "--font-display": "'Space Grotesk', ui-sans-serif, system-ui",
        "--font-body": "'Figtree', ui-sans-serif, system-ui"
      },
      "classes": {
        "heading": "font-[var(--font-display)] tracking-[-0.02em]",
        "body": "font-[var(--font-body)]"
      }
    },
    "type_scale": {
      "h1": "text-4xl sm:text-5xl lg:text-6xl font-semibold",
      "h2": "text-base md:text-lg font-medium text-muted-foreground",
      "section_title": "text-lg font-semibold",
      "card_title": "text-sm font-semibold uppercase tracking-wide",
      "body": "text-sm text-foreground/90 leading-6",
      "small": "text-xs text-muted-foreground"
    },
    "numbers": {
      "stat": "text-2xl font-semibold tabular-nums",
      "micro": "text-xs tabular-nums"
    }
  },
  "color_system": {
    "notes": [
      "Dark theme only. Use teal/cyan as primary brand accent.",
      "If tertiary accent needed: bright gold for highlights (credits, streaks, warnings).",
      "No purple usage (per rules).",
      "Gradients: decorative only, <=20% viewport, never on reading areas/cards."
    ],
    "palette_hex": {
      "bg": "#0B0D10",
      "surface": "#10151B",
      "surface_2": "#0F1720",
      "border": "#1E2A36",
      "text": "#F4F7FA",
      "muted_text": "#A7B3BF",
      "brand_teal": "#5BC2D4",
      "brand_teal_2": "#2FB7C9",
      "brand_teal_soft": "#A7E7F0",
      "gold": "#F2C94C",
      "success": "#2ED3A6",
      "danger": "#FF5A6A",
      "warning": "#F2C94C",
      "info": "#5BC2D4"
    },
    "shadcn_hsl_tokens_dark_only": {
      "instruction": "Replace current :root/.dark tokens in /app/frontend/src/index.css with these (HSL). Keep .dark on html/body always.",
      "tokens": {
        "--background": "215 28% 5%",
        "--foreground": "210 25% 97%",
        "--card": "214 28% 8%",
        "--card-foreground": "210 25% 97%",
        "--popover": "214 28% 8%",
        "--popover-foreground": "210 25% 97%",
        "--primary": "188 58% 60%",
        "--primary-foreground": "215 28% 8%",
        "--secondary": "214 22% 14%",
        "--secondary-foreground": "210 25% 97%",
        "--muted": "214 18% 16%",
        "--muted-foreground": "214 12% 72%",
        "--accent": "214 22% 14%",
        "--accent-foreground": "210 25% 97%",
        "--destructive": "352 86% 62%",
        "--destructive-foreground": "210 25% 97%",
        "--border": "214 22% 18%",
        "--input": "214 22% 18%",
        "--ring": "188 58% 60%",
        "--chart-1": "188 58% 60%",
        "--chart-2": "168 62% 52%",
        "--chart-3": "42 92% 62%",
        "--chart-4": "200 70% 58%",
        "--chart-5": "352 86% 62%",
        "--radius": "0.9rem"
      }
    },
    "semantic_tokens_additional": {
      "instruction": "Add these CSS vars under @layer base for consistent surfaces and shadows.",
      "css_vars": {
        "--app-bg": "hsl(var(--background))",
        "--app-surface": "hsl(214 28% 8%)",
        "--app-surface-2": "hsl(214 22% 12%)",
        "--app-elev": "0 10px 30px rgba(0,0,0,.35)",
        "--app-elev-soft": "0 8px 18px rgba(0,0,0,.25)",
        "--app-stroke": "hsl(214 22% 18%)",
        "--focus-ring": "0 0 0 3px rgba(91,194,212,.35)",
        "--selection": "rgba(91,194,212,.22)"
      }
    },
    "allowed_gradients": {
      "usage": "Hero header strip / decorative top glow only (<=20% viewport).",
      "examples": [
        "radial-gradient(600px circle at 20% -10%, rgba(91,194,212,.22), transparent 55%)",
        "linear-gradient(135deg, rgba(91,194,212,.18), rgba(242,201,76,.10))"
      ]
    },
    "texture": {
      "noise_overlay": {
        "instruction": "Use a subtle CSS noise overlay on app background only (not on cards).",
        "css": ".app-noise:before{content:'';position:fixed;inset:0;pointer-events:none;background-image:url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"160\" height=\"160\"><filter id=\"n\"><feTurbulence type=\"fractalNoise\" baseFrequency=\"0.9\" numOctaves=\"3\" stitchTiles=\"stitch\"/></filter><rect width=\"160\" height=\"160\" filter=\"url(%23n)\" opacity=\"0.08\"/></svg>');mix-blend-mode:overlay;opacity:.35}"
      }
    }
  },
  "layout_and_grid": {
    "mobile_first": {
      "base_width": 375,
      "container": "px-4 pb-20 pt-4 (pb accounts for bottom tabs)",
      "section_spacing": "space-y-4",
      "card_spacing": "p-4",
      "list_row_height": "min-h-[56px]"
    },
    "desktop": {
      "pattern": "Switch to left sidebar + top bar; keep content max-w-5xl; bottom tabs hidden.",
      "grid": "lg:grid lg:grid-cols-[260px_1fr] lg:gap-6"
    },
    "navigation": {
      "mobile_bottom_tabs": {
        "height": "h-16",
        "style": "blurred surface with border + active teal indicator",
        "tailwind": "fixed bottom-0 left-0 right-0 z-50 border-t bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60",
        "active_indicator": "absolute -top-px h-[2px] w-10 bg-primary rounded-full"
      },
      "coach_quick_add": {
        "pattern": "Floating action button above bottom tabs (create session / note / message)",
        "tailwind": "fixed bottom-20 right-4 z-50"
      }
    }
  },
  "components": {
    "component_path": {
      "button": "/app/frontend/src/components/ui/button.jsx",
      "card": "/app/frontend/src/components/ui/card.jsx",
      "tabs": "/app/frontend/src/components/ui/tabs.jsx",
      "dialog": "/app/frontend/src/components/ui/dialog.jsx",
      "drawer": "/app/frontend/src/components/ui/drawer.jsx",
      "sheet": "/app/frontend/src/components/ui/sheet.jsx",
      "input": "/app/frontend/src/components/ui/input.jsx",
      "textarea": "/app/frontend/src/components/ui/textarea.jsx",
      "select": "/app/frontend/src/components/ui/select.jsx",
      "badge": "/app/frontend/src/components/ui/badge.jsx",
      "table": "/app/frontend/src/components/ui/table.jsx",
      "calendar": "/app/frontend/src/components/ui/calendar.jsx",
      "popover": "/app/frontend/src/components/ui/popover.jsx",
      "dropdown_menu": "/app/frontend/src/components/ui/dropdown-menu.jsx",
      "scroll_area": "/app/frontend/src/components/ui/scroll-area.jsx",
      "separator": "/app/frontend/src/components/ui/separator.jsx",
      "sonner_toast": "/app/frontend/src/components/ui/sonner.jsx"
    },
    "buttons": {
      "shape": "Glass / Neomorphic-lite (rounded 10–14px), athletic",
      "variants": {
        "primary": {
          "usage": "Confirm, Save, Approve, Purchase",
          "tailwind": "bg-primary text-primary-foreground shadow-[0_10px_24px_rgba(91,194,212,.18)] hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary/40",
          "data_testid_examples": [
            "session-save-button",
            "booking-approve-button",
            "stripe-checkout-button"
          ]
        },
        "secondary": {
          "usage": "Neutral actions",
          "tailwind": "bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border"
        },
        "ghost": {
          "usage": "Inline actions in lists",
          "tailwind": "hover:bg-accent hover:text-accent-foreground"
        },
        "destructive": {
          "usage": "Cancel session, archive client",
          "tailwind": "bg-destructive text-destructive-foreground hover:bg-destructive/90"
        }
      },
      "sizes": {
        "sm": "h-9 px-3 text-sm",
        "md": "h-11 px-4 text-sm",
        "lg": "h-12 px-5 text-base"
      }
    },
    "cards_and_tiles": {
      "card_style": {
        "tailwind": "bg-card border border-border rounded-[var(--radius)] shadow-[var(--app-elev-soft)]",
        "header": "flex items-start justify-between gap-3",
        "title": "text-sm font-semibold uppercase tracking-wide text-muted-foreground",
        "value": "text-2xl font-semibold text-foreground tabular-nums"
      },
      "stat_tile": {
        "pattern": "Bento tiles on dashboards (2-col on mobile, 4-col on desktop)",
        "grid": "grid grid-cols-2 gap-3 lg:grid-cols-4",
        "accent_bar": "before:content-[''] before:absolute before:inset-x-0 before:top-0 before:h-[2px] before:bg-primary/70"
      }
    },
    "lists": {
      "client_row": {
        "pattern": "Tap row opens detail; trailing quick actions in dropdown",
        "tailwind": "flex items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 hover:bg-card focus-within:ring-2 focus-within:ring-primary/30",
        "left": "avatar + name + status",
        "right": "credits badge + chevron"
      },
      "session_row": {
        "pattern": "Time block + client + status chip + swipe-like actions via dropdown",
        "status_badges": {
          "upcoming": "bg-primary/15 text-primary border border-primary/25",
          "completed": "bg-emerald-500/15 text-emerald-200 border border-emerald-500/25",
          "canceled": "bg-destructive/15 text-destructive border border-destructive/25"
        }
      }
    },
    "tabs": {
      "client_detail_tabs": {
        "pattern": "Sticky tabs under header; horizontal scroll on mobile",
        "tailwind": "sticky top-0 z-40 bg-background/80 backdrop-blur border-b border-border",
        "tab_list": "w-full justify-start overflow-x-auto",
        "tab_trigger": "data-[state=active]:text-primary data-[state=active]:border-primary"
      }
    },
    "forms": {
      "inputs": {
        "tailwind": "h-11 rounded-xl bg-background/40 border-border focus-visible:ring-2 focus-visible:ring-primary/35",
        "helper_text": "text-xs text-muted-foreground"
      },
      "notes_editor": {
        "pattern": "Textarea with quick chips (RPE, mood, pain) + share-to-client switch",
        "components": ["textarea", "switch", "badge", "toggle-group"],
        "data_testid_examples": [
          "session-notes-textarea",
          "session-notes-share-switch"
        ]
      }
    },
    "calendar_and_scheduling": {
      "use": "shadcn calendar + popover for date picking; list-first scheduling on mobile",
      "mobile_pattern": "Upcoming list with day separators; create/edit in Drawer",
      "desktop_pattern": "Optional month view in side panel",
      "components": ["calendar", "popover", "drawer", "select"]
    },
    "messaging": {
      "thread_list": {
        "pattern": "Unread indicator dot + last message preview",
        "tailwind": "rounded-xl border border-border bg-card px-4 py-3"
      },
      "conversation": {
        "pattern": "Bubbles with role-based tint; composer fixed above bottom tabs",
        "bubble": {
          "coach": "bg-primary/15 border border-primary/20",
          "client": "bg-secondary border border-border"
        },
        "composer": "fixed bottom-16 left-0 right-0 px-4 pb-3 bg-background/80 backdrop-blur border-t"
      }
    },
    "waiver": {
      "pattern": "Readable legal text in ScrollArea + typed signature input + consent checkbox",
      "components": ["scroll-area", "checkbox", "input", "card"],
      "data_testid_examples": [
        "waiver-signature-input",
        "waiver-consent-checkbox",
        "waiver-submit-button"
      ]
    },
    "payments_and_credits": {
      "credits_badge": "Use gold accent sparingly for credits balance and package highlights.",
      "not_configured_state": {
        "pattern": "Card with icon + explanation + disabled CTA",
        "tailwind": "border border-dashed border-border bg-card/40"
      }
    }
  },
  "data_viz": {
    "library": "recharts",
    "palette": {
      "primary_line": "hsl(var(--chart-1))",
      "secondary_line": "hsl(var(--chart-2))",
      "highlight": "hsl(var(--chart-3))",
      "danger": "hsl(var(--chart-5))",
      "grid": "rgba(167,179,191,.18)",
      "tooltip_bg": "hsl(214 28% 8%)"
    },
    "chart_rules": {
      "stroke_width": 2.5,
      "dot": "r=2.5 activeDot r=4",
      "axes": "ticks muted; hide axis lines; keep grid subtle",
      "empty_state": "Show skeleton + 'No metrics yet' with CTA to add first measurement",
      "interaction": "Tap point -> tooltip; long-press on mobile optional"
    },
    "recharts_scaffold_js": {
      "example": "<ResponsiveContainer width=\"100%\" height={220}><LineChart data={data}><CartesianGrid stroke=\"rgba(167,179,191,.18)\" vertical={false} /><XAxis dataKey=\"date\" tick={{ fill: 'rgba(167,179,191,.75)', fontSize: 12 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: 'rgba(167,179,191,.75)', fontSize: 12 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ background: 'hsl(214 28% 8%)', border: '1px solid hsl(214 22% 18%)', borderRadius: 12 }} /><Line type=\"monotone\" dataKey=\"value\" stroke=\"hsl(var(--chart-1))\" strokeWidth={2.5} dot={{ r: 2.5 }} activeDot={{ r: 4 }} /></LineChart></ResponsiveContainer>"
    }
  },
  "motion_and_microinteractions": {
    "library": "framer-motion",
    "principles": [
      "Fast, subtle, purposeful (coaches are between sets)",
      "Use motion for state change: create session drawer, approve booking, message send",
      "Avoid large parallax/heavy effects (performance)"
    ],
    "patterns": {
      "page_enter": "opacity 0 -> 1, y 6 -> 0, duration 0.18",
      "card_hover_desktop": "translateY(-2px) + shadow increase (desktop only)",
      "button_press": "scale 0.98 on tap",
      "list_row_tap": "brief bg accent flash: bg-primary/10"
    },
    "do_not": ["transition-all"]
  },
  "accessibility": {
    "wcag": "AA",
    "focus": "Always visible focus ring using --focus-ring; never remove outline without replacement.",
    "contrast": "Muted text must still be readable on near-black; avoid gray < 60% lightness for body.",
    "reduced_motion": "Respect prefers-reduced-motion: disable entrance animations and long transitions.",
    "forms": "Labels always present; errors in destructive color + helper text"
  },
  "testing_attributes": {
    "rule": "All interactive and key informational elements MUST include data-testid (kebab-case).",
    "examples": {
      "auth": [
        "login-email-input",
        "login-password-input",
        "login-submit-button",
        "invite-claim-submit-button",
        "invite-invalid-state-text"
      ],
      "coach": [
        "coach-dashboard-today-sessions-card",
        "coach-quick-add-button",
        "client-list-search-input",
        "client-archive-toggle",
        "session-create-button"
      ],
      "client": [
        "client-home-next-session-card",
        "credits-balance-text",
        "booking-request-button",
        "program-video-link"
      ],
      "admin": [
        "admin-reassign-client-button",
        "waiver-version-create-button",
        "package-create-button"
      ]
    }
  },
  "images": {
    "image_urls": [
      {
        "category": "auth",
        "description": "Subtle background image for login (blurred + dark overlay). Keep behind content; do not reduce readability.",
        "url": "https://images.unsplash.com/photo-1595886509089-b691b210fc5c?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85"
      },
      {
        "category": "empty_states",
        "description": "Optional illustration/photo for empty progress metrics (use very small, low-contrast).",
        "url": "https://images.unsplash.com/photo-1579450887184-a097e4201342?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85"
      },
      {
        "category": "coach_dashboard_header",
        "description": "Optional header image strip (cropped, heavily darkened).",
        "url": "https://images.unsplash.com/photo-1451597827324-4b55a7ebc5b7?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85"
      }
    ]
  },
  "instructions_to_main_agent": [
    "Remove default CRA App.css centering patterns; do not center the app container.",
    "Set dark theme as default by applying class 'dark' at the root (html/body) and use ONLY the dark token set above.",
    "Implement mobile bottom tab navigation for coach and client areas; hide on desktop and use sidebar.",
    "Use Drawer/Sheet for create/edit flows on mobile (sessions, notes, program builder) to keep context.",
    "Use recharts with the provided palette and tooltip styling; include empty states and skeletons.",
    "Use shadcn/ui components from /src/components/ui only (no raw HTML dropdown/calendar/toast).",
    "Every interactive element and key info text must include data-testid in kebab-case.",
    "Avoid gradients except small decorative glows (<=20% viewport). No purple gradients.",
    "Keep touch targets >=44px and spacing generous; coaches operate one-handed between sets."
  ]
}

<General UI UX Design Guidelines>  
    - You must **not** apply universal transition. Eg: `transition: all`. This results in breaking transforms. Always add transitions for specific interactive elements like button, input excluding transforms
    - You must **not** center align the app container, ie do not add `.App { text-align: center; }` in the css file. This disrupts the human natural reading flow of text
   - NEVER: use AI assistant Emoji characters like`🤖🧠💭💡🔮🎯📚🎭🎬🎪🎉🎊🎁🎀🎂🍰🎈🎨🎰💰💵💳🏦💎🪙💸🤑📊📈📉💹🔢🏆🥇 etc for icons. Always use **FontAwesome cdn** or **lucid-react** library already installed in the package.json

 **GRADIENT RESTRICTION RULE**
NEVER use dark/saturated gradient combos (e.g., purple/pink) on any UI element.  Prohibited gradients: blue-500 to purple 600, purple 500 to pink-500, green-500 to blue-500, red to pink etc
NEVER use dark gradients for logo, testimonial, footer etc
NEVER let gradients cover more than 20% of the viewport.
NEVER apply gradients to text-heavy content or reading areas.
NEVER use gradients on small UI elements (<100px width).
NEVER stack multiple gradient layers in the same viewport.

**ENFORCEMENT RULE:**
    • Id gradient area exceeds 20% of viewport OR affects readability, **THEN** use solid colors

**How and where to use:**
   • Section backgrounds (not content backgrounds)
   • Hero section header content. Eg: dark to light to dark color
   • Decorative overlays and accent elements only
   • Hero section with 2-3 mild color
   • Gradients creation can be done for any angle say horizontal, vertical or diagonal

- For AI chat, voice application, **do not use purple color. Use color like light green, ocean blue, peach orange etc**

</Font Guidelines>

- Every interaction needs micro-animations - hover states, transitions, parallax effects, and entrance animations. Static = dead. 
   
- Use 2-3x more spacing than feels comfortable. Cramped designs look cheap.

- Subtle grain textures, noise overlays, custom cursors, selection states, and loading animations: separates good from extraordinary.
   
- Before generating UI, infer the visual style from the problem statement (palette, contrast, mood, motion) and immediately instantiate it by setting global design tokens (primary, secondary/accent, background, foreground, ring, state colors), rather than relying on any library defaults. Don't make the background dark as a default step, always understand problem first and define colors accordingly
    Eg: - if it implies playful/energetic, choose a colorful scheme
           - if it implies monochrome/minimal, choose a black–white/neutral scheme

**Component Reuse:**
	- Prioritize using pre-existing components from src/components/ui when applicable
	- Create new components that match the style and conventions of existing components when needed
	- Examine existing components to understand the project's component patterns before creating new ones

**IMPORTANT**: Do not use HTML based component like dropdown, calendar, toast etc. You **MUST** always use `/app/frontend/src/components/ui/ ` only as a primary components as these are modern and stylish component

**Best Practices:**
	- Use Shadcn/UI as the primary component library for consistency and accessibility
	- Import path: ./components/[component-name]

**Export Conventions:**
	- Components MUST use named exports (export const ComponentName = ...)
	- Pages MUST use default exports (export default function PageName() {...})

**Toasts:**
  - Use `sonner` for toasts"
  - Sonner component are located in `/app/src/components/ui/sonner.tsx`

Use 2–4 color gradients, subtle textures/noise overlays, or CSS-based noise to avoid flat visuals.
</General UI UX Design Guidelines>
