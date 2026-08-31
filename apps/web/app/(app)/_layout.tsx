import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Icon } from '@/components/ui/icon';
import { Separator } from '@/components/ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { Text } from '@/components/ui/text';
import {
  ARCHIVED_WORKSPACES,
  CURRENT_USER,
  getWorkspace,
  PLACEHOLDER_WORKSPACES,
} from '@/lib/placeholder-data';
import { Slot, useGlobalSearchParams, usePathname, useRouter, type Href } from 'expo-router';
import {
  ArchiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  FolderIcon,
  LogOutIcon,
  SettingsIcon,
} from 'lucide-react-native';
import * as React from 'react';
import { Pressable, View } from 'react-native';

export default function AppLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <TopBar />
        <Slot />
      </SidebarInset>
    </SidebarProvider>
  );
}

function AppSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const [archivedCollapsed, setArchivedCollapsed] = React.useState(true);

  function navigate(href: Href) {
    router.push(href);
    if (isMobile) {
      setOpenMobile(false);
    }
  }

  return (
    <Sidebar side="left" collapsible="offcanvas">
      <SidebarHeader>
        <Pressable
          className="h-12 flex-row items-center gap-2 rounded-md px-2"
          onPress={() => navigate('/')}>
          <View className="bg-sidebar-primary h-7 w-7 items-center justify-center rounded-md">
            <Text className="text-sidebar-primary-foreground text-sm font-bold">T</Text>
          </View>
          <Text className="text-sidebar-foreground text-base font-semibold tracking-tight">
            Temujira
          </Text>
        </Pressable>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspaces</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {PLACEHOLDER_WORKSPACES.map((workspace) => {
                const isActive = pathname.startsWith(`/w/${workspace.key}`);
                return (
                  <SidebarMenuItem key={workspace.key}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onPress={() => navigate(`/w/${workspace.key}`)}>
                      <Icon
                        as={FolderIcon}
                        className={
                          isActive ? 'text-sidebar-accent-foreground size-4' : 'text-sidebar-foreground size-4'
                        }
                      />
                      <Text numberOfLines={1} className="flex-1 pr-6">
                        {workspace.name}
                      </Text>
                    </SidebarMenuButton>
                    <SidebarMenuBadge>{workspace.count}</SidebarMenuBadge>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarSeparator />
        <SidebarGroup>
          <Pressable
            onPress={() => setArchivedCollapsed((current) => !current)}
            accessibilityRole="button"
            accessibilityState={{ expanded: !archivedCollapsed }}>
            <SidebarGroupLabel>
              <View className="flex-1 flex-row items-center justify-between">
                <Text className="text-sidebar-foreground/70 text-xs font-medium">Archived</Text>
                <Icon
                  as={archivedCollapsed ? ChevronRightIcon : ChevronDownIcon}
                  className="text-sidebar-foreground/70 size-3.5"
                />
              </View>
            </SidebarGroupLabel>
          </Pressable>
          {!archivedCollapsed ? (
            <SidebarGroupContent>
              <SidebarMenu>
                {ARCHIVED_WORKSPACES.map((workspace) => (
                  <SidebarMenuItem key={workspace.key}>
                    <SidebarMenuButton
                      isActive={pathname.startsWith(`/w/${workspace.key}`)}
                      onPress={() => navigate(`/w/${workspace.key}`)}>
                      <Icon as={ArchiveIcon} className="text-sidebar-foreground/70 size-4" />
                      <Text numberOfLines={1} className="text-sidebar-foreground/70 flex-1 pr-6">
                        {workspace.name}
                      </Text>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          ) : null}
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Pressable className="active:bg-sidebar-accent h-12 flex-row items-center gap-2 rounded-md px-2">
              <Avatar alt={CURRENT_USER.name} className="size-7">
                <AvatarFallback>
                  <Text className="text-xs">{CURRENT_USER.initials}</Text>
                </AvatarFallback>
              </Avatar>
              <View className="min-w-0 flex-1">
                <Text numberOfLines={1} className="text-sidebar-foreground text-sm font-medium">
                  {CURRENT_USER.name}
                </Text>
                <Text numberOfLines={1} className="text-sidebar-foreground/70 text-xs">
                  Admin
                </Text>
              </View>
              <Icon as={ChevronsUpDownIcon} className="text-sidebar-foreground/70 size-4" />
            </Pressable>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>{CURRENT_USER.name}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onPress={() => navigate('/settings/profile')}>
              <Icon as={SettingsIcon} className="size-4" />
              <Text>Settings</Text>
            </DropdownMenuItem>
            <DropdownMenuItem onPress={() => router.replace('/login')}>
              <Icon as={LogOutIcon} className="size-4" />
              <Text>Sign out</Text>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

function TopBar() {
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ key?: string; num?: string }>();

  let title = 'Overview';
  if (pathname.startsWith('/settings')) {
    title = 'Settings';
  } else if (typeof params.key === 'string') {
    const workspace = getWorkspace(params.key);
    const workspaceName = workspace?.name ?? params.key.toUpperCase();
    title =
      typeof params.num === 'string'
        ? `${workspaceName} / ${params.key.toUpperCase()}-${params.num}`
        : workspaceName;
  }

  return (
    <View className="border-border h-14 flex-row items-center gap-2 border-b px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-4" />
      <Text numberOfLines={1} className="text-sm font-medium">
        {title}
      </Text>
    </View>
  );
}
