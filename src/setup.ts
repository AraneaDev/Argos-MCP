#!/usr/bin/env node

/**
 * Setup Entry Point for Claude SQL MCP Server
 *
 * This script provides an interactive configuration wizard for setting up
 * database connections and server settings for the Claude SQL MCP Server.
 *
 * Usage:
 * npm run setup
 * node dist/setup.js
 * node dist/setup.js --config=/path/to/config.ini
 * node dist/setup.js --skip-tests
 */

import { SetupWizard } from './setup/wizard.js';
import { ConfigGenerator } from './setup/config-generator.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { SERVER_VERSION } from './types/index.js';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);

interface CliOptions {
  configPath?: string;
  skipTests?: boolean;
  generateTemplate?: 'production' | 'development' | 'minimal' | 'sample';
  help?: boolean;
  version?: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--version' || arg === '-v') {
      options.version = true;
    } else if (arg === '--skip-tests') {
      options.skipTests = true;
    } else if (arg.startsWith('--config=')) {
      options.configPath = arg.split('=')[1];
    } else if (arg === '--config') {
      options.configPath = args[++i];
    } else if (arg.startsWith('--template=')) {
      const template = arg.split('=')[1] as string;
      if (['production', 'development', 'minimal', 'sample'].includes(template)) {
        options.generateTemplate = template as typeof options.generateTemplate;
      } else {
        // eslint-disable-next-line no-console
        console.error(` Invalid template type: ${template}`);
        // eslint-disable-next-line no-console
        console.error('Valid templates: production, development, minimal, sample');
        process.exit(1);
      }
    } else if (arg === '--template') {
      const template = args[++i] as string;
      if (['production', 'development', 'minimal', 'sample'].includes(template)) {
        options.generateTemplate = template as typeof options.generateTemplate;
      } else {
        // eslint-disable-next-line no-console
        console.error(` Invalid template type: ${template}`);
        // eslint-disable-next-line no-console
        console.error('Valid templates: production, development, minimal, sample');
        process.exit(1);
      }
    }
  }

  return options;
}

function showHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`
 Claude SQL MCP Server Setup

USAGE:
 npm run setup Interactive configuration wizard
 node dist/setup.js Interactive configuration wizard
 
OPTIONS:
 --config=<path> Custom config file path (default: ./config.ini)
 --skip-tests Skip connection tests
 --template=<type> Generate template configuration
 --help, -h Show this help message
 --version, -v Show version information

TEMPLATES:
 production Production-ready configuration with security
 development Development configuration with debug enabled
 minimal Minimal configuration for simple setups
 sample Sample configuration with examples

EXAMPLES:
 # Interactive setup
 npm run setup
 
 # Generate production template
 node dist/setup.js --template=production
 
 # Setup with custom config path
 node dist/setup.js --config=/etc/claude-sql/config.ini
 
 # Setup without connection tests
 node dist/setup.js --skip-tests

For more information, visit: https://github.com/AraneaDev/mcp-sql-access-server
`);
}

function showVersion(): void {
  try {
    const packagePath = path.join(currentDir, '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
    // eslint-disable-next-line no-console
    console.log(`Claude SQL MCP Server v${packageJson.version}`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.log(`Claude SQL MCP Server v${SERVER_VERSION}`);
  }
}

async function generateTemplate(
  templateType: 'production' | 'development' | 'minimal' | 'sample'
): Promise<void> {
  try {
    // eslint-disable-next-line no-console
    console.log(` Generating ${templateType} configuration template...`);

    let configFile;
    if (templateType === 'sample') {
      configFile = ConfigGenerator.generateSampleConfig();
    } else {
      configFile = ConfigGenerator.generateTemplate(templateType);
    }

    const filename = `config.${templateType}.ini`;
    // Config files are meant to hold DB/SSH credentials — restrict to owner only.
    fs.writeFileSync(filename, configFile.content, { mode: 0o600 });

    // eslint-disable-next-line no-console
    console.log(` Template saved to: ${filename}`);
    // eslint-disable-next-line no-console
    console.log('\n Template Information:');
    // eslint-disable-next-line no-console
    console.log(` Description: ${configFile.metadata.description}`);
    // eslint-disable-next-line no-console
    console.log(` Databases: ${configFile.metadata.database_count}`);
    // eslint-disable-next-line no-console
    console.log(` SSH Enabled: ${configFile.metadata.ssh_enabled ? '' : ''}`);
    // eslint-disable-next-line no-console
    console.log(` Security Settings: ${configFile.metadata.security_enabled ? '' : ''}`);

    // eslint-disable-next-line no-console
    console.log('\n Next Steps:');
    // eslint-disable-next-line no-console
    console.log(` 1. Review and customize ${filename}`);
    // eslint-disable-next-line no-console
    console.log(` 2. Rename to config.ini or use --config=${filename}`);
    // eslint-disable-next-line no-console
    console.log(` 3. Update connection details (passwords, hosts, etc.)`);
    // eslint-disable-next-line no-console
    console.log(` 4. Run 'npm start' to start the server`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(' Failed to generate template:', (error as Error).message);
    process.exit(1);
  }
}

async function runInteractiveSetup(options: CliOptions): Promise<void> {
  const wizard = new SetupWizard({
    configPath: options.configPath,
    skipTests: options.skipTests,
  });

  try {
    await wizard.run();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(' Setup failed:', (error as Error).message);
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.error('Stack trace:', (error as Error).stack);
    }
    process.exit(1);
  } finally {
    wizard.close();
  }
}

async function main(): Promise<void> {
  // Handle uncaught exceptions gracefully
  process.on('uncaughtException', (error) => {
    // eslint-disable-next-line no-console
    console.error(' Uncaught Exception:', error.message);
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.error(error.stack);
    }
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    // eslint-disable-next-line no-console
    console.error(' Unhandled Rejection at:', promise);
    // eslint-disable-next-line no-console
    console.error('Reason:', reason);
    process.exit(1);
  });

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    // eslint-disable-next-line no-console
    console.log('\n Setup cancelled by user');
    process.exit(0);
  });

  const args = process.argv.slice(2);
  const options = parseArgs(args);

  // Show help
  if (options.help) {
    showHelp();
    return;
  }

  // Show version
  if (options.version) {
    showVersion();
    return;
  }

  // Generate template
  if (options.generateTemplate) {
    await generateTemplate(options.generateTemplate);
    return;
  }

  // Run interactive setup
  await runInteractiveSetup(options);
}

// Execute main function
main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(' Setup process failed:', error.message);
  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line no-console
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
});
