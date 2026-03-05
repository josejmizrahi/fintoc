"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";

interface DetailPanelProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  tabs?: string[];
  className?: string;
}

export function DetailPanel({
  isOpen,
  onClose,
  title,
  children,
  tabs,
  className,
}: DetailPanelProps) {
  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className={cn("w-full sm:max-w-lg", className)}
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>

        <ScrollArea className="flex-1 px-4 pb-4">
          {tabs && tabs.length > 0 ? (
            <Tabs defaultValue={tabs[0]}>
              <TabsList>
                {tabs.map((tab) => (
                  <TabsTrigger key={tab} value={tab}>
                    {tab}
                  </TabsTrigger>
                ))}
              </TabsList>
              {React.Children.map(children, (child, index) => {
                const tabValue = tabs[index];
                if (!tabValue) return null;
                return (
                  <TabsContent key={tabValue} value={tabValue}>
                    {child}
                  </TabsContent>
                );
              })}
            </Tabs>
          ) : (
            children
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
