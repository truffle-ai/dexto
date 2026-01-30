/**
 * Event Log Store Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useEventLogStore } from './eventLogStore.js';

describe('eventLogStore', () => {
    beforeEach(() => {
        // Reset store to default state
        useEventLogStore.setState({
            events: [],
            maxEvents: 1000,
        });
    });

    describe('addEvent', () => {
        it('should add event with generated id', () => {
            const { addEvent } = useEventLogStore.getState();

            addEvent({
                name: 'llm:thinking',
                category: 'agent',
                description: 'Agent started processing',
                timestamp: Date.now(),
                sessionId: 'session-1',
            });

            const { events } = useEventLogStore.getState();
            expect(events).toHaveLength(1);
            expect(events[0].id).toMatch(/^evt-\d+-[a-z0-9]+$/);
            expect(events[0].name).toBe('llm:thinking');
            expect(events[0].category).toBe('agent');
            expect(events[0].sessionId).toBe('session-1');
        });

        it('should add multiple events in order', () => {
            const { addEvent } = useEventLogStore.getState();

            addEvent({
                name: 'llm:thinking',
                category: 'agent',
                description: 'First event',
                timestamp: 1000,
            });

            addEvent({
                name: 'llm:response',
                category: 'agent',
                description: 'Second event',
                timestamp: 2000,
            });

            const { events } = useEventLogStore.getState();
            expect(events).toHaveLength(2);
            expect(events[0].description).toBe('First event');
            expect(events[1].description).toBe('Second event');
        });

        it('should store metadata', () => {
            const { addEvent } = useEventLogStore.getState();

            addEvent({
                name: 'llm:tool-call',
                category: 'tool',
                description: 'Tool call',
                timestamp: Date.now(),
                metadata: {
                    toolName: 'read_file',
                    args: { path: '/test.txt' },
                },
            });

            const { events } = useEventLogStore.getState();
            expect(events[0].metadata).toEqual({
                toolName: 'read_file',
                args: { path: '/test.txt' },
            });
        });
    });

    describe('maxEvents limit', () => {
        it('should cap events at maxEvents', () => {
            const { addEvent, setMaxEvents } = useEventLogStore.getState();

            setMaxEvents(3);

            // Add 5 events
            for (let i = 0; i < 5; i++) {
                addEvent({
                    name: 'llm:chunk',
                    category: 'agent',
                    description: `Event ${i}`,
                    timestamp: Date.now() + i,
                });
            }

            const { events } = useEventLogStore.getState();
            expect(events).toHaveLength(3);
            // Should keep the newest 3
            expect(events[0].description).toBe('Event 2');
            expect(events[1].description).toBe('Event 3');
            expect(events[2].description).toBe('Event 4');
        });

        it('should trim existing events when maxEvents is reduced', () => {
            const { addEvent, setMaxEvents } = useEventLogStore.getState();

            // Add 5 events
            for (let i = 0; i < 5; i++) {
                addEvent({
                    name: 'llm:chunk',
                    category: 'agent',
                    description: `Event ${i}`,
                    timestamp: Date.now() + i,
                });
            }

            let events = useEventLogStore.getState().events;
            expect(events).toHaveLength(5);

            // Reduce maxEvents to 2
            setMaxEvents(2);

            events = useEventLogStore.getState().events;
            expect(events).toHaveLength(2);
            // Should keep the newest 2
            expect(events[0].description).toBe('Event 3');
            expect(events[1].description).toBe('Event 4');
        });

        it('should not trim if maxEvents is increased', () => {
            const { addEvent, setMaxEvents } = useEventLogStore.getState();

            setMaxEvents(3);

            // Add 3 events
            for (let i = 0; i < 3; i++) {
                addEvent({
                    name: 'llm:chunk',
                    category: 'agent',
                    description: `Event ${i}`,
                    timestamp: Date.now() + i,
                });
            }

            let events = useEventLogStore.getState().events;
            expect(events).toHaveLength(3);

            // Increase maxEvents
            setMaxEvents(100);

            events = useEventLogStore.getState().events;
            expect(events).toHaveLength(3);
        });
    });

    describe('clearEvents', () => {
        it('should clear all events', () => {
            const { addEvent, clearEvents } = useEventLogStore.getState();

            addEvent({
                name: 'llm:thinking',
                category: 'agent',
                description: 'Event 1',
                timestamp: Date.now(),
            });

            addEvent({
                name: 'llm:response',
                category: 'agent',
                description: 'Event 2',
                timestamp: Date.now(),
            });

            let events = useEventLogStore.getState().events;
            expect(events).toHaveLength(2);

            clearEvents();

            events = useEventLogStore.getState().events;
            expect(events).toHaveLength(0);
        });
    });

    describe('clearSessionEvents', () => {
        it('should remove only matching session events', () => {
            const { addEvent, clearSessionEvents } = useEventLogStore.getState();

            addEvent({
                name: 'llm:thinking',
                category: 'agent',
                description: 'Session 1 event',
                timestamp: Date.now(),
                sessionId: 'session-1',
            });

            addEvent({
                name: 'llm:thinking',
                category: 'agent',
                description: 'Session 2 event',
                timestamp: Date.now(),
                sessionId: 'session-2',
            });

            addEvent({
                name: 'connection:status',
                category: 'system',
                description: 'No session event',
                timestamp: Date.now(),
            });

            expect(useEventLogStore.getState().events).toHaveLength(3);

            clearSessionEvents('session-1');

            const events = useEventLogStore.getState().events;
            expect(events).toHaveLength(2);
            expect(events[0].description).toBe('Session 2 event');
            expect(events[1].description).toBe('No session event');
        });

        it('should handle clearing non-existent session', () => {
            const { addEvent, clearSessionEvents } = useEventLogStore.getState();

            addEvent({
                name: 'llm:thinking',
                category: 'agent',
                description: 'Event',
                timestamp: Date.now(),
                sessionId: 'session-1',
            });

            let events = useEventLogStore.getState().events;
            expect(events).toHaveLength(1);

            clearSessionEvents('non-existent');

            events = useEventLogStore.getState().events;
            expect(events).toHaveLength(1);
        });
    });

    describe('getEventsBySession', () => {
        it('should filter events by session id', () => {
            const { addEvent, getEventsBySession } = useEventLogStore.getState();

            addEvent({
                name: 'llm:thinking',
                category: 'agent',
                description: 'Session 1 event 1',
                timestamp: Date.now(),
                sessionId: 'session-1',
            });

            addEvent({
                name: 'llm:response',
                category: 'agent',
                description: 'Session 2 event',
                timestamp: Date.now(),
                sessionId: 'session-2',
            });

            addEvent({
                name: 'llm:chunk',
                category: 'agent',
                description: 'Session 1 event 2',
                timestamp: Date.now(),
                sessionId: 'session-1',
            });

            const session1Events = getEventsBySession('session-1');
            expect(session1Events).toHaveLength(2);
            expect(session1Events[0].description).toBe('Session 1 event 1');
            expect(session1Events[1].description).toBe('Session 1 event 2');
        });

        it('should return empty array for non-existent session', () => {
            const { addEvent, getEventsBySession } = useEventLogStore.getState();

            addEvent({
                name: 'llm:thinking',
                category: 'agent',
                description: 'Event',
                timestamp: Date.now(),
                sessionId: 'session-1',
            });

            const events = getEventsBySession('non-existent');
            expect(events).toHaveLength(0);
        });
    });

    describe('getEventsByCategory', () => {
        it('should filter events by category', () => {
            const { addEvent, getEventsByCategory } = useEventLogStore.getState();

            addEvent({
                name: 'llm:thinking',
                category: 'agent',
                description: 'Agent event 1',
                timestamp: Date.now(),
            });

            addEvent({
                name: 'llm:tool-call',
                category: 'tool',
                description: 'Tool event',
                timestamp: Date.now(),
            });

            addEvent({
                name: 'llm:response',
                category: 'agent',
                description: 'Agent event 2',
                timestamp: Date.now(),
            });

            const agentEvents = getEventsByCategory('agent');
            expect(agentEvents).toHaveLength(2);
            expect(agentEvents[0].description).toBe('Agent event 1');
            expect(agentEvents[1].description).toBe('Agent event 2');

            const toolEvents = getEventsByCategory('tool');
            expect(toolEvents).toHaveLength(1);
            expect(toolEvents[0].description).toBe('Tool event');
        });

        it('should return empty array for category with no events', () => {
            const { addEvent, getEventsByCategory } = useEventLogStore.getState();

            addEvent({
                name: 'llm:thinking',
                category: 'agent',
                description: 'Agent event',
                timestamp: Date.now(),
            });

            const approvalEvents = getEventsByCategory('approval');
            expect(approvalEvents).toHaveLength(0);
        });
    });

    describe('getRecentEvents', () => {
        it('should return correct number of recent events', () => {
            const { addEvent, getRecentEvents } = useEventLogStore.getState();

            // Add 5 events
            for (let i = 0; i < 5; i++) {
                addEvent({
                    name: 'llm:chunk',
                    category: 'agent',
                    description: `Event ${i}`,
                    timestamp: Date.now() + i,
                });
            }

            const recent = getRecentEvents(3);
            expect(recent).toHaveLength(3);
            // Should get the last 3
            expect(recent[0].description).toBe('Event 2');
            expect(recent[1].description).toBe('Event 3');
            expect(recent[2].description).toBe('Event 4');
        });

        it('should return all events if limit exceeds count', () => {
            const { addEvent, getRecentEvents } = useEventLogStore.getState();

            addEvent({
                name: 'llm:thinking',
                category: 'agent',
                description: 'Event 1',
                timestamp: Date.now(),
            });

            addEvent({
                name: 'llm:response',
                category: 'agent',
                description: 'Event 2',
                timestamp: Date.now(),
            });

            const recent = getRecentEvents(10);
            expect(recent).toHaveLength(2);
        });

        it('should return empty array if no events', () => {
            const { getRecentEvents } = useEventLogStore.getState();

            const recent = getRecentEvents(5);
            expect(recent).toHaveLength(0);
        });
    });
});
