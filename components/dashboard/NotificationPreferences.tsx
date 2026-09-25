"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { NotificationEventType } from "@/lib/api";
import {
  useNotificationPreferences,
  useUpdateNotificationPreferenceMutation,
} from "@/hooks/useNotificationPreferences";

const EVENT_LABELS: Record<NotificationEventType, string> = {
  new_invoice: "New invoice",
  funding_milestone: "Funding milestone",
  settlement: "Settlement",
  early_repayment: "Early repayment",
};

function NotificationPreferencesSkeleton() {
  return (
    <div className="space-y-3" data-testid="notification-preferences-loading">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between py-2">
          <Skeleton className="h-4 w-32" />
          <div className="flex items-center gap-6">
            <Skeleton className="h-5 w-9" />
            <Skeleton className="h-5 w-9" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function NotificationPreferences() {
  const { data: preferences, isLoading } = useNotificationPreferences();
  const { mutate: updatePreference } = useUpdateNotificationPreferenceMutation();

  return (
    <Card>
      <CardHeader>
        <h1 className="text-lg font-semibold">Notification Preferences</h1>
        <p className="text-sm text-muted-foreground">
          Choose how you want to be notified for each event type.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading || !preferences ? (
          <NotificationPreferencesSkeleton />
        ) : (
          <div className="divide-y">
            {preferences.map((pref) => (
              <div key={pref.event_type} className="flex items-center justify-between py-3">
                <span className="text-sm font-medium">{EVENT_LABELS[pref.event_type]}</span>
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    Email
                    <Switch
                      checked={pref.email}
                      onCheckedChange={(checked) =>
                        updatePreference({
                          eventType: pref.event_type,
                          channel: "email",
                          enabled: checked,
                        })
                      }
                      aria-label={`Email notifications for ${EVENT_LABELS[pref.event_type]}`}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    In-app
                    <Switch
                      checked={pref.in_app}
                      onCheckedChange={(checked) =>
                        updatePreference({
                          eventType: pref.event_type,
                          channel: "in_app",
                          enabled: checked,
                        })
                      }
                      aria-label={`In-app notifications for ${EVENT_LABELS[pref.event_type]}`}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
