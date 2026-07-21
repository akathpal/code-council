CREATE TABLE `agent_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`display_name` text NOT NULL,
	`adapter_kind` text NOT NULL,
	`endpoint` text,
	`capabilities_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'disconnected' NOT NULL,
	`last_healthcheck_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_connections_provider_idx` ON `agent_connections` (`provider`);--> statement-breakpoint
CREATE INDEX `agent_connections_status_idx` ON `agent_connections` (`status`);--> statement-breakpoint
CREATE TABLE `council_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`protocol_json` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `council_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`stage` text NOT NULL,
	`event_type` text NOT NULL,
	`agent_id` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `council_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_run_sequence_idx` ON `council_events` (`run_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `events_run_stage_idx` ON `council_events` (`run_id`,`stage`);--> statement-breakpoint
CREATE TABLE `council_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`definition_id` text NOT NULL,
	`task` text NOT NULL,
	`task_class` text DEFAULT 'general' NOT NULL,
	`risk_tier` text DEFAULT 'routine' NOT NULL,
	`base_commit_sha` text NOT NULL,
	`context_pack_id` text,
	`strategy` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`stage` text DEFAULT 'context' NOT NULL,
	`confidence` real,
	`verdict` text,
	`deliverable_ref` text,
	`cost_micros` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`started_at` text,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`definition_id`) REFERENCES `council_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `runs_repository_created_idx` ON `council_runs` (`repository_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `runs_status_idx` ON `council_runs` (`status`);--> statement-breakpoint
CREATE INDEX `runs_strategy_idx` ON `council_runs` (`strategy`);--> statement-breakpoint
CREATE TABLE `evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`success` integer,
	`tests_passed` integer DEFAULT 0 NOT NULL,
	`tests_total` integer DEFAULT 0 NOT NULL,
	`static_checks_passed` integer DEFAULT 0 NOT NULL,
	`static_checks_total` integer DEFAULT 0 NOT NULL,
	`human_approved` integer,
	`review_comments` integer DEFAULT 0 NOT NULL,
	`review_debt_score` integer DEFAULT 0 NOT NULL,
	`confidence` real,
	`cost_micros` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `council_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `evaluations_run_idx` ON `evaluations` (`run_id`);--> statement-breakpoint
CREATE INDEX `evaluations_success_idx` ON `evaluations` (`success`);--> statement-breakpoint
CREATE TABLE `human_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`github_review_id` text,
	`verdict` text NOT NULL,
	`severity` text DEFAULT 'medium' NOT NULL,
	`comment` text NOT NULL,
	`file_path` text,
	`line` integer,
	`author_hash` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `council_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `feedback_run_idx` ON `human_feedback` (`run_id`);--> statement-breakpoint
CREATE INDEX `feedback_severity_idx` ON `human_feedback` (`severity`);--> statement-breakpoint
CREATE TABLE `memory_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`path` text,
	`symbol` text,
	`content_hash` text NOT NULL,
	`source_commit_sha` text NOT NULL,
	`summary` text NOT NULL,
	`evidence_json` text DEFAULT '[]' NOT NULL,
	`confidence` real DEFAULT 0.5 NOT NULL,
	`generator` text DEFAULT 'deterministic' NOT NULL,
	`generator_version` text DEFAULT 'v1' NOT NULL,
	`supersedes_id` text,
	`valid_from` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`valid_to` text,
	`retrieval_count` integer DEFAULT 0 NOT NULL,
	`successful_use_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_repository_kind_idx` ON `memory_artifacts` (`repository_id`,`kind`);--> statement-breakpoint
CREATE INDEX `memory_repository_hash_idx` ON `memory_artifacts` (`repository_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX `memory_repository_valid_idx` ON `memory_artifacts` (`repository_id`,`valid_to`);--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`default_branch` text DEFAULT 'main' NOT NULL,
	`installation_id` text,
	`clone_url` text,
	`last_indexed_sha` text,
	`memory_status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `repositories_owner_name_idx` ON `repositories` (`owner`,`name`);--> statement-breakpoint
CREATE INDEX `repositories_memory_status_idx` ON `repositories` (`memory_status`);