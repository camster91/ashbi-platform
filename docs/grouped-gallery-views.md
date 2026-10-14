# Grouped tables and gallery task views

Project task views now support a gallery layout and grouping by status, priority, stage or an active scalar/choice field. Gallery cards retain canonical task links, assignment, due date and selected custom-field values. Tables render accessible row groups. Multi-select tasks appear once in each selected-choice group; the task count remains the count of unique matching records. Missing values remain in an Unspecified group, with typed zero and false preserved.

Grouping and gallery settings are shared saved-view metadata, protected by the existing metadata revision and tenant checks. Board templates retain valid grouping configuration. Grouping is displayed in table and gallery layouts; board/calendar layouts retain their existing organization. Relational grouping needs complete authorized label resolution and remains follow-up work. This does not introduce standalone databases, formulas or rollups.

Local tests cover saved gallery reload, grouping integrity, invalid or archived grouping definitions and gallery detail/link rendering. Authenticated CI and target acceptance remain separate gates; production is held.
