-- Read-only. Run on the hosted database BEFORE applying
-- 20260929120000_shared_training_library.sql. Needs no new columns.
--
-- Predicts what the "live-assigned template" (409) guard will lock on day one:
-- every template that an active, pre-existing assignment still points at.
-- Mirrors the guard: archived programs/workouts are ignored, and a workout also
-- counts when it sits inside a program that has an active assignment.

WITH locked_programs AS (
  SELECT p.id, p.name, count(pa.id) AS active_assignments
  FROM public.programs p
  JOIN public.program_assignments pa ON pa.program_id = p.id AND pa.archived = false
  WHERE p.archived = false
  GROUP BY p.id, p.name
), locked_workouts AS (
  SELECT w.id, w.name
  FROM public.workouts w
  WHERE w.archived = false
    AND (
      EXISTS (SELECT 1 FROM public.workout_assignments wa
              WHERE wa.workout_id = w.id AND wa.archived = false)
      OR EXISTS (SELECT 1 FROM public.program_days pd
                 JOIN locked_programs lp ON lp.id = pd.program_id
                 WHERE pd.workout_id = w.id AND pd.archived = false)
    )
)
SELECT 'summary' AS kind, 'programs locked' AS name, count(*)::text AS detail FROM locked_programs
UNION ALL
SELECT 'summary', 'workouts locked', count(*)::text FROM locked_workouts
UNION ALL
SELECT 'summary', 'active program assignments', count(*)::text
  FROM public.program_assignments WHERE archived = false
UNION ALL
SELECT 'summary', 'active standalone workout assignments', count(*)::text
  FROM public.workout_assignments WHERE archived = false
UNION ALL
SELECT 'program', name, active_assignments::text || ' active assignment(s)' FROM locked_programs
UNION ALL
SELECT 'workout', name, '' FROM locked_workouts
ORDER BY 1, 2;
