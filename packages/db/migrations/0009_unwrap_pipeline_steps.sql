-- Some pipeline versions were saved with their steps encoded twice: a JSON
-- string holding the array, not the array. Every reader of `steps` expects an
-- array, and `jsonb_array_length` on the pipelines list fails the whole page
-- on one such row ("cannot get array length of a scalar"). The array is all
-- there inside the string, so this unwraps it rather than discarding it.
UPDATE "pipeline_versions" SET "steps" = ("steps" #>> '{}')::jsonb WHERE jsonb_typeof("steps") = 'string';
