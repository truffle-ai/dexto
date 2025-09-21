'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Badge } from './ui/badge';
import { AlertTriangle, Wrench, Clock, FileText } from 'lucide-react';
import { useChatContext } from './hooks/ChatContext';
import { ElicitationForm } from './ElicitationForm';

interface ToolConfirmationEvent {
    executionId: string;
    toolName: string;
    args: any;
    description?: string;
    timestamp: Date;
    sessionId?: string;
}

interface ElicitationEvent {
    executionId: string;
    message: string;
    requestedSchema: object;
    timestamp: Date;
    sessionId?: string;
    serverName?: string;
}

type UserApprovalEvent = ToolConfirmationEvent | ElicitationEvent;

function isElicitationEvent(event: UserApprovalEvent): event is ElicitationEvent {
    return 'message' in event && 'requestedSchema' in event;
}

interface UserApprovalHandlerProps {
    websocket?: WebSocket | null;
}

/**
 * Unified WebUI component for handling both tool confirmations and elicitation requests
 * Displays appropriate dialogs and sends responses back through WebSocket
 */
export function UserApprovalHandler({ websocket }: UserApprovalHandlerProps) {
    const [pendingApproval, setPendingApproval] = useState<UserApprovalEvent | null>(null);
    const [rememberChoice, setRememberChoice] = useState(false);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const { currentSessionId } = useChatContext();

    // Queue to hold requests that arrive while a dialog is already open
    const queuedRequestsRef = React.useRef<UserApprovalEvent[]>([]);

    // Handle incoming WebSocket messages
    useEffect(() => {
        if (!websocket) return;

        const handleMessage = (event: MessageEvent) => {
            try {
                const message = JSON.parse(event.data);
                
                if (message.event === 'toolConfirmationRequest' || message.event === 'elicitationRequest') {
                    // Tool confirmations must match the active session for security
                    // Elicitation requests can proceed without sessionId (MCP SDK limitation)
                    const sid = message?.data?.sessionId as string | undefined;
                    if (message.event === 'toolConfirmationRequest' && (!sid || sid !== currentSessionId)) return;
                    if (message.event === 'elicitationRequest' && sid && sid !== currentSessionId) return;

                    const approvalEvent: UserApprovalEvent = message.event === 'elicitationRequest' 
                        ? {
                            ...message.data,
                            timestamp: new Date(message.data.timestamp),
                          } as ElicitationEvent
                        : {
                            ...message.data,
                            timestamp: new Date(message.data.timestamp),
                          } as ToolConfirmationEvent;

                    console.debug(`[WebUI] Received ${message.event}`, approvalEvent);

                    if (isDialogOpen) {
                        // Buffer the request to be shown later
                        queuedRequestsRef.current.push(approvalEvent);
                    } else {
                        setPendingApproval(approvalEvent);
                        setIsDialogOpen(true);
                        setRememberChoice(false);
                    }
                }
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };

        websocket.addEventListener('message', handleMessage);
        
        return () => {
            websocket.removeEventListener('message', handleMessage);
        };
    }, [websocket, isDialogOpen, currentSessionId]);

    // Send tool confirmation response
    const sendToolConfirmationResponse = useCallback((approved: boolean) => {
        if (!pendingApproval || !websocket || isElicitationEvent(pendingApproval)) return;

        const response = {
            type: 'toolConfirmationResponse',
            data: {
                executionId: pendingApproval.executionId,
                approved,
                rememberChoice,
                sessionId: pendingApproval.sessionId,
            }
        };

        console.debug('[WebUI] Sending toolConfirmationResponse', response);
        websocket.send(JSON.stringify(response));
        
        closeDialogAndShowNext();
    }, [pendingApproval, rememberChoice, websocket]);

    // Send elicitation response
    const sendElicitationResponse = useCallback((action: 'accept' | 'decline' | 'cancel', data?: object) => {
        if (!pendingApproval || !websocket || !isElicitationEvent(pendingApproval)) return;

        const response = {
            type: 'elicitationResponse',
            data: {
                executionId: pendingApproval.executionId,
                action,
                ...(data && { data }),
                sessionId: pendingApproval.sessionId,
            }
        };

        console.debug('[WebUI] Sending elicitationResponse', response);
        websocket.send(JSON.stringify(response));
        
        closeDialogAndShowNext();
    }, [pendingApproval, websocket]);

    const closeDialogAndShowNext = useCallback(() => {
        // Close dialog and reset state
        setIsDialogOpen(false);
        setPendingApproval(null);
        setRememberChoice(false);

        // If there are queued requests, show the next one
        if (queuedRequestsRef.current.length > 0) {
            const next = queuedRequestsRef.current.shift()!;
            // slight delay to allow dialog close animation
            setTimeout(() => {
                setPendingApproval(next);
                setIsDialogOpen(true);
            }, 0);
        }
    }, []);

    // Tool confirmation handlers
    const handleToolApprove = () => sendToolConfirmationResponse(true);
    const handleToolDeny = () => sendToolConfirmationResponse(false);

    // Elicitation handlers
    const handleElicitationAccept = (data: object) => sendElicitationResponse('accept', data);
    const handleElicitationDecline = () => sendElicitationResponse('decline');
    const handleElicitationCancel = () => sendElicitationResponse('cancel');

    // Format arguments for display (tool confirmations)
    const formatArgs = (args: any): string => {
        if (!args) return 'No arguments';
        
        try {
            return JSON.stringify(args, null, 2);
        } catch {
            return String(args);
        }
    };

    // Auto-close dialog after timeout (safety feature)
    useEffect(() => {
        if (!isDialogOpen) return;

        const timeout = setTimeout(() => {
            // Auto-deny/cancel after 2 minutes for security
            if (isElicitationEvent(pendingApproval!)) {
                sendElicitationResponse('cancel');
            } else {
                sendToolConfirmationResponse(false);
            }
        }, 120000);

        return () => clearTimeout(timeout);
    }, [isDialogOpen, pendingApproval, sendElicitationResponse, sendToolConfirmationResponse]);

    if (!pendingApproval) return null;

    const isElicitation = isElicitationEvent(pendingApproval);

    return (
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
            if (!open) {
                // If user closes dialog without responding, default to deny/cancel
                if (isElicitation) {
                    sendElicitationResponse('cancel');
                } else {
                    sendToolConfirmationResponse(false);
                }
            }
        }}>
            <DialogContent className="sm:max-w-[800px] max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {isElicitation ? (
                            <>
                                <FileText className="h-5 w-5 text-blue-500" />
                                Information Request
                            </>
                        ) : (
                            <>
                                <AlertTriangle className="h-5 w-5 text-yellow-500" />
                                Tool Execution Confirmation
                            </>
                        )}
                    </DialogTitle>
                </DialogHeader>
                
                <div className="space-y-4 overflow-y-auto flex-1 min-h-0">
                    {isElicitation ? (
                        <ElicitationForm
                            event={pendingApproval}
                            onAccept={handleElicitationAccept}
                            onDecline={handleElicitationDecline}
                            onCancel={handleElicitationCancel}
                        />
                    ) : (
                        <>
                            <div className="flex items-center gap-2">
                                <Wrench className="h-4 w-4 text-blue-500" />
                                <span className="font-medium">Tool:</span>
                                <Badge variant="outline">{pendingApproval.toolName}</Badge>
                            </div>

                            {pendingApproval.description && (
                                <div>
                                    <span className="font-medium">Description:</span>
                                    <p className="text-sm text-gray-600 mt-1">{pendingApproval.description}</p>
                                </div>
                            )}

                            <div className="flex flex-col">
                                <span className="font-medium mb-2">Arguments:</span>
                                <div className="bg-background/50 p-3 rounded-md text-xs overflow-auto max-h-80 min-h-16 text-muted-foreground border">
                                    <pre className="whitespace-pre-wrap break-words font-mono">
                                        {formatArgs(pendingApproval.args)}
                                    </pre>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 text-sm text-gray-500">
                                <Clock className="h-4 w-4" />
                                <span>Requested at: {pendingApproval.timestamp.toLocaleString()}</span>
                            </div>

                            <div className="flex items-center space-x-2">
                                <Checkbox 
                                    id="remember" 
                                    checked={rememberChoice}
                                    onCheckedChange={(checked) => setRememberChoice(checked === true)}
                                    className="ml-1"
                                />
                                <label 
                                    htmlFor="remember" 
                                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                >
                                    Approve future executions of this tool for this session
                                </label>
                            </div>

                            <div className="bg-yellow-50 p-3 rounded-md">
                                <p className="text-sm text-yellow-800">
                                    <strong>Security Notice:</strong> Only approve tools you trust. 
                                    Tools can access your system and data according to their permissions.
                                </p>
                            </div>
                        </>
                    )}
                </div>

                {!isElicitation && (
                    <DialogFooter className="gap-2 flex-shrink-0 mt-4 pt-4 border-t">
                        <Button 
                            variant="outline" 
                            onClick={handleToolDeny}
                            className="bg-red-50 hover:bg-red-100 text-red-700 border-red-200"
                        >
                            Deny
                        </Button>
                        <Button 
                            onClick={handleToolApprove}
                            className="bg-green-600 hover:bg-green-700"
                        >
                            Approve
                        </Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
}