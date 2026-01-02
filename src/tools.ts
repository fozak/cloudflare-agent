//  my-agent/src/tools.ts

/**
 * Tool definitions for the AI chat agent
 * Tools can either require human confirmation or execute automatically
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod/v3";

import type { Chat } from "./server";
import { getCurrentAgent } from "agents";
import { scheduleSchema } from "agents/schedule";

/**
 * Weather information tool that executes automatically
 * Safe read-only operation, no confirmation needed
 */
const getWeatherInformation = tool({
  description: "show the weather in a given city to the user",
  inputSchema: z.object({ city: z.string() }),
  execute: async ({ city }) => {
    console.log(`Getting weather information for ${city}`);
    return `The weather in ${city} is sunny`;
  }
});

/**
 * Local time tool that executes automatically
 * Since it includes an execute function, it will run without user confirmation
 * This is suitable for low-risk operations that don't need oversight
 */
const getLocalTime = tool({
  description: "get the local time for a specified location",
  inputSchema: z.object({ location: z.string() }),
  execute: async ({ location }) => {
    console.log(`Getting local time for ${location}`);
    return "10am";
  }
});

const scheduleTask = tool({
  description: "A tool to schedule a task to be executed at a later time",
  inputSchema: scheduleSchema,
  execute: async ({ when, description }) => {
    // we can now read the agent context from the ALS store
    const { agent } = getCurrentAgent<Chat>();

    function throwError(msg: string): string {
      throw new Error(msg);
    }
    if (when.type === "no-schedule") {
      return "Not a valid schedule input";
    }
    const input =
      when.type === "scheduled"
        ? when.date // scheduled
        : when.type === "delayed"
          ? when.delayInSeconds // delayed
          : when.type === "cron"
            ? when.cron // cron
            : throwError("not a valid schedule input");
    try {
      agent!.schedule(input!, "executeTask", description);
    } catch (error) {
      console.error("error scheduling task", error);
      return `Error scheduling task: ${error}`;
    }
    return `Task scheduled for type "${when.type}" : ${input}`;
  }
});

/**
 * Tool to list all scheduled tasks
 * This executes automatically without requiring human confirmation
 */
const getScheduledTasks = tool({
  description: "List all tasks that have been scheduled",
  inputSchema: z.object({}),
  execute: async () => {
    const { agent } = getCurrentAgent<Chat>();

    try {
      const tasks = agent!.getSchedules();
      if (!tasks || tasks.length === 0) {
        return "No scheduled tasks found.";
      }
      return tasks;
    } catch (error) {
      console.error("Error listing scheduled tasks", error);
      return `Error listing scheduled tasks: ${error}`;
    }
  }
});

/**
 * Tool to cancel a scheduled task by its ID
 * This executes automatically without requiring human confirmation
 */
const cancelScheduledTask = tool({
  description: "Cancel a scheduled task using its ID",
  inputSchema: z.object({
    taskId: z.string().describe("The ID of the task to cancel")
  }),
  execute: async ({ taskId }) => {
    const { agent } = getCurrentAgent<Chat>();
    try {
      await agent!.cancelSchedule(taskId);
      return `Task ${taskId} has been successfully canceled.`;
    } catch (error) {
      console.error("Error canceling scheduled task", error);
      return `Error canceling task ${taskId}: ${error}`;
    }
  }
});

/**
 * Database schema discovery tool
 */
const getDatabaseSchema = tool({
  description: "Get the schema of the current chat's SQLite database. Shows all tables and their column definitions.",
  inputSchema: z.object({}),
  execute: async () => {
    const { agent } = getCurrentAgent<Chat>();
    
    try {
      const storage = agent!.ctx.storage.sql;
      
      // ✅ CORRECT: Call .toArray() on cursor
      const tables = storage.exec(
        "SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name"
      ).toArray();
      
      if (!tables || tables.length === 0) {
        return "No tables found in database.";
      }
      
      // Format schema info
      const schemaInfo = tables.map((table: any) => ({
        table: table.name,
        createStatement: table.sql
      }));
      
      return JSON.stringify({
        database: "SQLite (Cloudflare Durable Object)",
        tableCount: tables.length,
        tables: schemaInfo
      }, null, 2);
      
    } catch (error) {
      console.error("Schema error:", error);
      return `Error getting schema: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }
});

/**
 * SQL query tool that executes automatically
 */
const executeSQLQuery = tool({
  description: `Execute a read-only SQLite query against the current chat's Durable Object storage.

This is a SQLite 3.x database. Use standard SQLite syntax including:
- LIKE for text search: WHERE column LIKE '%search%'
- datetime() for date handling
- Aggregations: COUNT(*), SUM(), AVG(), MAX(), MIN()

Tip: Use getDatabaseSchema tool first to see available tables and columns.

Only SELECT queries are allowed for security.`,
  
  inputSchema: z.object({
    query: z.string().describe("SQLite SELECT query using standard SQLite 3.x syntax"),
    limit: z.number().optional().default(100).describe("Maximum rows to return (default 100, max 500)")
  }),
  execute: async ({ query, limit }) => {
    const { agent } = getCurrentAgent<Chat>();
    
    try {
      // Safety: Only allow SELECT queries
      const normalizedQuery = query.trim().toLowerCase();
      if (!normalizedQuery.startsWith('select')) {
        return "Error: Only SELECT queries are allowed for security reasons. Please start your query with SELECT.";
      }
      
      const storage = agent!.ctx.storage.sql;
      
      // Safety check: prevent unlimited queries
      const safeLimit = Math.min(limit || 100, 500);
      
      // Add LIMIT if not present
      const limitedQuery = normalizedQuery.includes('limit') 
        ? query 
        : `${query} LIMIT ${safeLimit}`;
      
      // ✅ CORRECT: Call .toArray() on cursor
      const rows = storage.exec(limitedQuery).toArray();
      
      // Format results
      if (!rows || rows.length === 0) {
        return JSON.stringify({
          rowCount: 0,
          rows: [],
          query: limitedQuery,
          message: "Query executed successfully. No results returned."
        }, null, 2);
      }
      
      // Return formatted results
      return JSON.stringify({
        rowCount: rows.length,
        rows: rows,
        query: limitedQuery
      }, null, 2);
      
    } catch (error) {
      console.error("SQL query error:", error);
      return `SQL Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }
});

/**
 * Export all available tools
 * These will be provided to the AI model to describe available capabilities
 */
/**
 * Export all available tools
 * These will be provided to the AI model to describe available capabilities
 */
export const tools = {
  getWeatherInformation,
  getLocalTime,
  scheduleTask,
  getScheduledTasks,
  cancelScheduledTask,
  getDatabaseSchema,    // ← ADDED THIS LINE
  executeSQLQuery
} satisfies ToolSet;

/**
 * Implementation of confirmation-required tools
 * This object contains the actual logic for tools that need human approval
 * Each function here corresponds to a tool above that doesn't have an execute function
 * 
 * Currently empty - all tools auto-execute for simplicity
 */
export const executions = {};
