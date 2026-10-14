# Team work and logged capacity

Team workload and resource allocations compare the last seven days of logged time with the capacity percentage configured in Profile or Team (100 percent = 40 hours per week; 50 percent = 20 hours per week). Values above 100 percent remain visible. Zero or missing capacity is unconfigured, excluded from the average, and shown as Set capacity. This measurement does not forecast availability or convert arbitrary task/thread counts into hours.

Owned active tasks and explicit contributions are separate counts and may overlap. A contributor is not made the accountable owner. Completed or deleted tasks and deleted projects are excluded. Allocation project counts cover owned work; contributor counts are shown separately. Data is grouped in the database, with staff and project labels read in bounded pages, so the default 100-row list cap cannot silently truncate totals.

The authenticated workload and allocation API and `get_team_workload` MCP read tool require staff access and keep explicit organization filters, including raw-client queries. No hourly rates, individual time-entry descriptions or credentials are returned. API-key scope and revocation rules remain the existing workspace-read contract.

Local unit and UI checks, PostgreSQL tenant/aggregation evidence, and authenticated mobile/accessibility CI acceptance are required before this slice is ready. Production remains held.

Stored capacity percentages are preserved. No production values are migrated. Values previously entered through the hours-labelled Profile field need owner review before any data correction.
