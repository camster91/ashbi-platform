#!/usr/bin/env node

// Integration test script for Discord/OpenClaw sync

import { PrismaClient } from '@prisma/client';
import { emitHubEvent } from '../src/events/hub-events.js';
import { setupEventListeners } from '../src/events/hub-events.js';

const prisma = new PrismaClient();

async function testIntegrations() {
  console.log('🧪 Testing Agency Hub Integrations...\n');

  // Setup event listeners
  setupEventListeners();

  try {
    // Test 1: Project Created
    console.log('1. Testing Project Created Event...');
    const mockProject = {
      id: 'test-project-' + Date.now(),
      name: 'Test Project - Integration Test',
      description: 'This is a test project for integration testing',
      status: 'STARTING_UP',
      createdAt: new Date()
    };

    const mockClient = {
      id: 'test-client-' + Date.now(),
      name: 'Test Client Inc.',
      domain: 'testclient.com',
      status: 'ACTIVE'
    };

    emitHubEvent.projectCreated(mockProject, mockClient);
    console.log('   ✅ Project created event emitted\n');

    // Test 2: Task Assigned
    console.log('2. Testing Task Assignment Event...');
    const mockTask = {
      id: 'test-task-' + Date.now(),
      title: 'Test Task - Integration Test',
      description: 'This is a test task for integration testing',
      priority: 'HIGH',
      status: 'PENDING',
      createdAt: new Date()
    };

    const mockUser = {
      id: 'test-user-' + Date.now(),
      name: 'Cameron A',
      email: 'cameron@ashbi.ca',
      role: 'ADMIN'
    };

    emitHubEvent.taskAssigned(mockTask, mockUser, mockProject, mockClient);
    console.log('   ✅ Task assigned event emitted\n');

    // Test 3: Client Message
    console.log('3. Testing Client Message Event...');
    const mockThread = {
      id: 'test-thread-' + Date.now(),
      subject: 'Test Message - Integration Test',
      status: 'OPEN',
      createdAt: new Date()
    };

    emitHubEvent.clientMessageReceived(mockThread, mockClient, 'This is a test client message for integration testing');
    console.log('   ✅ Client message event emitted\n');

    // Test 4: Response Draft Ready
    console.log('4. Testing Response Draft Ready Event...');
    const mockResponse = {
      id: 'test-response-' + Date.now(),
      content: 'Thank you for your message. This is a test response generated for integration testing. We will review your request and get back to you shortly.',
      status: 'PENDING_APPROVAL',
      aiGenerated: true,
      createdAt: new Date()
    };

    emitHubEvent.responseDraftReady(mockResponse, mockThread, mockClient);
    console.log('   ✅ Response draft ready event emitted\n');

    // Test 5: Deployment Success
    console.log('5. Testing Deployment Event...');
    emitHubEvent.deploymentSuccess(
      'production', 
      'abc123def456', 
      'feat: add Discord/OpenClaw integration tests'
    );
    console.log('   ✅ Deployment success event emitted\n');

    // Test 6: Alert
    console.log('6. Testing Alert Event...');
    emitHubEvent.alertTriggered(
      'Integration Test Alert',
      'This is a test alert to verify the Discord/OpenClaw integration is working correctly.',
      'info'
    );
    console.log('   ✅ Alert event emitted\n');

    console.log('🎉 All integration tests completed!');
    console.log('\nCheck your Discord channels and OpenClaw for the test notifications.');
    console.log('\nIf you see notifications in Discord/OpenClaw, the integration is working! 🚀');

  } catch (error) {
    console.error('❌ Integration test failed:', error);
    process.exit(1);
  }

  // Wait a moment for async events to process
  setTimeout(() => {
    console.log('\n📊 Test Summary:');
    console.log('- Events should appear in Discord #agency-hub channel');
    console.log('- Deployment event should appear in Discord #deployments channel');  
    console.log('- Alert should appear in Discord #alerts channel');
    console.log('- All events should be sent to OpenClaw');
    console.log('\n✨ Integration test complete!');
    process.exit(0);
  }, 3000);
}

// Run tests
testIntegrations().catch(console.error);