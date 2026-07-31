import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

// classNames follow the react-day-picker v9 slot names (the v8 names this
// file originally carried — caption, nav_button, head_row — no longer exist).
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("relative p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-4",
        month: "flex flex-col gap-4",
        // 44px controls throughout — scheduling is a primary mobile flow and
        // the app's touch-target floor is 44px.
        month_caption: "flex h-11 items-center justify-center",
        caption_label: "text-sm font-medium",
        nav: "absolute inset-x-3 top-3 z-10 flex items-center justify-between",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "h-11 w-11 bg-transparent p-0 opacity-50 hover:opacity-100"
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "h-11 w-11 bg-transparent p-0 opacity-50 hover:opacity-100"
        ),
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-11 rounded-md text-[0.8rem] font-normal text-muted-foreground",
        week: "mt-1 flex w-full",
        day: cn(
          "relative p-0 text-center text-sm focus-within:relative focus-within:z-20",
          "[&:has([aria-selected])]:rounded-md [&:has([aria-selected])]:bg-accent"
        ),
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-11 w-11 p-0 font-normal aria-selected:opacity-100"
        ),
        range_start: "day-range-start",
        range_end: "day-range-end",
        selected:
          "rounded-md bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground",
        today: "rounded-md bg-accent text-accent-foreground",
        outside: "text-muted-foreground opacity-50 aria-selected:bg-accent/50",
        disabled: "text-muted-foreground opacity-50",
        range_middle: "aria-selected:bg-accent aria-selected:text-accent-foreground",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClassName, ...chevronProps }) => (
          orientation === "left"
            ? <ChevronLeft className={cn("h-4 w-4", chevronClassName)} {...chevronProps} />
            : <ChevronRight className={cn("h-4 w-4", chevronClassName)} {...chevronProps} />
        ),
      }}
      {...props} />
  );
}
Calendar.displayName = "Calendar"

export { Calendar }
