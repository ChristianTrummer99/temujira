import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
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
import { useAuth } from '@/lib/auth';
import { InboxProvider, useInbox } from '@/lib/inbox';
import { WorkspaceListProvider, useWorkspaceList } from '@/lib/workspaces';
import { Slot, useGlobalSearchParams, usePathname, useRouter, type Href } from 'expo-router';
import {
  ArchiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  CircleUserIcon,
  FolderIcon,
  InboxIcon,
  ListOrderedIcon,
  LogOutIcon,
  PlusIcon,
  SettingsIcon,
} from 'lucide-react-native';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function AppLayout() {
  const { loading, user } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return null;
  }

  return (
    <WorkspaceListProvider>
      <InboxProvider>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>
            <TopBar />
            <Slot />
          </SidebarInset>
        </SidebarProvider>
      </InboxProvider>
    </WorkspaceListProvider>
  );
}

function AppSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const { user, logout } = useAuth();
  const { workspaces, archived, reload } = useWorkspaceList();
  const { unread } = useInbox();

  const [archivedCollapsed, setArchivedCollapsed] = React.useState(true);

  function navigate(href: Href) {
    router.push(href);
    if (isMobile) {
      setOpenMobile(false);
    }
  }

  const initials = user?.name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

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
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname === '/inbox'}
                  onPress={() => navigate('/inbox')}>
                  <Icon
                    as={InboxIcon}
                    className={
                      pathname === '/inbox'
                        ? 'text-sidebar-accent-foreground size-4'
                        : 'text-sidebar-foreground size-4'
                    }
                  />
                  <Text className="flex-1 pr-8">Inbox</Text>
                </SidebarMenuButton>
                {unread > 0 ? (
                  <SidebarMenuBadge className="bg-primary top-1.5">
                    <Text className="text-primary-foreground text-[10px] font-semibold tabular-nums">
                      {unread > 99 ? '99+' : String(unread)}
                    </Text>
                  </SidebarMenuBadge>
                ) : null}
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={pathname === '/my'} onPress={() => navigate('/my')}>
                  <Icon
                    as={CircleUserIcon}
                    className={
                      pathname === '/my'
                        ? 'text-sidebar-accent-foreground size-4'
                        : 'text-sidebar-foreground size-4'
                    }
                  />
                  <Text className="flex-1 pr-6">My Tasks</Text>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname === '/queue'}
                  onPress={() => navigate('/queue')}>
                  <Icon
                    as={ListOrderedIcon}
                    className={
                      pathname === '/queue'
                        ? 'text-sidebar-accent-foreground size-4'
                        : 'text-sidebar-foreground size-4'
                    }
                  />
                  <Text className="flex-1 pr-6">My Queue</Text>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarSeparator />
        <SidebarGroup>
          <View className="flex-row items-center justify-between pr-2">
            <SidebarGroupLabel>Workspaces</SidebarGroupLabel>
            <CreateWorkspaceDialog onCreated={reload} />
          </View>
          <SidebarGroupContent>
            <SidebarMenu>
              {workspaces.map((workspace) => {
                const isActive = pathname.startsWith(`/w/${workspace.key}`);
                return (
                  <SidebarMenuItem key={workspace.id}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onPress={() => navigate(`/w/${workspace.key}`)}>
                      <Icon
                        as={FolderIcon}
                        className={
                          isActive
                            ? 'text-sidebar-accent-foreground size-4'
                            : 'text-sidebar-foreground size-4'
                        }
                      />
                      <Text numberOfLines={1} className="flex-1 pr-6">
                        {workspace.name}
                      </Text>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              {workspaces.length === 0 ? (
                <SidebarMenuItem>
                  <Text className="text-sidebar-foreground/60 px-2 text-xs">
                    No workspaces yet
                  </Text>
                </SidebarMenuItem>
              ) : null}
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
                {archived.map((workspace) => (
                  <SidebarMenuItem key={workspace.id}>
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
                {archived.length === 0 ? (
                  <SidebarMenuItem>
                    <Text className="text-sidebar-foreground/60 px-2 text-xs">
                      Nothing archived
                    </Text>
                  </SidebarMenuItem>
                ) : null}
              </SidebarMenu>
            </SidebarGroupContent>
          ) : null}
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Pressable className="active:bg-sidebar-accent h-12 flex-row items-center gap-2 rounded-md px-2">
              <Avatar alt={user?.name ?? ''} className="size-7">
                <AvatarFallback>
                  <Text className="text-xs">{initials}</Text>
                </AvatarFallback>
              </Avatar>
              <View className="min-w-0 flex-1">
                <Text numberOfLines={1} className="text-sidebar-foreground text-sm font-medium">
                  {user?.name}
                </Text>
                <Text numberOfLines={1} className="text-sidebar-foreground/70 text-xs">
                  {user?.role === 'admin' ? 'Admin' : 'Member'}
                </Text>
              </View>
              <Icon as={ChevronsUpDownIcon} className="text-sidebar-foreground/70 size-4" />
            </Pressable>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>{user?.name}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onPress={() => navigate('/settings')}>
              <Icon as={SettingsIcon} className="size-4" />
              <Text>Settings</Text>
            </DropdownMenuItem>
            <DropdownMenuItem
              onPress={async () => {
                await logout();
                router.replace('/login');
              }}>
              <Icon as={LogOutIcon} className="size-4" />
              <Text>Sign out</Text>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

function TopBarShell({ children }: { children: React.ReactNode }) {
  return (
    <View className="border-border h-14 flex-row items-center gap-2 border-b px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-4" />
      <View className="flex-1 flex-row items-center gap-1.5">{children}</View>
    </View>
  );
}

function TopBar() {
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ key?: string; num?: string }>();
  const router = useRouter();
  const { all } = useWorkspaceList();

  const workspaceKey = typeof params.key === 'string' ? params.key.toUpperCase() : null;
  const workspaceName = workspaceKey
    ? (all.find((w) => w.key === workspaceKey)?.name ?? workspaceKey)
    : null;

  if (pathname === '/') {
    return (
      <TopBarShell>
        <Breadcrumb active>Overview</Breadcrumb>
      </TopBarShell>
    );
  }

  if (pathname === '/inbox') {
    return (
      <TopBarShell>
        <BreadcrumbLink onPress={() => router.push('/')}>Overview</BreadcrumbLink>
        <BreadcrumbSep />
        <Breadcrumb active>Inbox</Breadcrumb>
      </TopBarShell>
    );
  }

  if (pathname === '/my') {
    return (
      <TopBarShell>
        <BreadcrumbLink onPress={() => router.push('/')}>Overview</BreadcrumbLink>
        <BreadcrumbSep />
        <Breadcrumb active>My Tasks</Breadcrumb>
      </TopBarShell>
    );
  }

  if (pathname === '/queue') {
    return (
      <TopBarShell>
        <BreadcrumbLink onPress={() => router.push('/')}>Overview</BreadcrumbLink>
        <BreadcrumbSep />
        <Breadcrumb active>My Queue</Breadcrumb>
      </TopBarShell>
    );
  }

  if (pathname.startsWith('/settings')) {
    return (
      <TopBarShell>
        <BreadcrumbLink onPress={() => router.push('/')}>Overview</BreadcrumbLink>
        <BreadcrumbSep />
        <Breadcrumb active>Settings</Breadcrumb>
      </TopBarShell>
    );
  }

  if (workspaceKey) {
    const path = `/w/${workspaceKey}`;
    const atTask = typeof params.num === 'string';
    const atActivity = pathname.endsWith('/activity');
    return (
      <TopBarShell>
        <BreadcrumbLink onPress={() => router.push('/')}>Overview</BreadcrumbLink>
        <BreadcrumbSep />
        {atTask || atActivity ? (
          <>
            <BreadcrumbLink onPress={() => router.push(path)}>{workspaceName}</BreadcrumbLink>
            <BreadcrumbSep />
            <Breadcrumb active>
              {atTask ? `${workspaceKey}-${params.num}` : 'Activity'}
            </Breadcrumb>
          </>
        ) : (
          <Breadcrumb active>{workspaceName}</Breadcrumb>
        )}
      </TopBarShell>
    );
  }

  return (
    <TopBarShell>
      <Breadcrumb active>Overview</Breadcrumb>
    </TopBarShell>
  );
}

function Breadcrumb({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <Text
      numberOfLines={1}
      className={active ? 'text-foreground text-sm font-medium' : 'text-muted-foreground text-sm'}>
      {children}
    </Text>
  );
}

function BreadcrumbLink({ children, onPress }: { children: React.ReactNode; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" className="active:opacity-70">
      <Text
        numberOfLines={1}
        className="text-muted-foreground hover:text-foreground text-sm underline-offset-2 hover:underline">
        {children}
      </Text>
    </Pressable>
  );
}

function BreadcrumbSep() {
  return <Text className="text-muted-foreground/50 text-sm">/</Text>;
}

function CreateWorkspaceDialog({ onCreated }: { onCreated: () => void }) {
  const { client } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [key, setKey] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Suggest a key from the name (uppercase initials, 2-6 chars).
  function suggestKey(value: string): string {
    const words = value
      .trim()
      .split(/\s+/)
      .map((w) => w.replace(/[^A-Za-z0-9]/g, ''))
      .filter(Boolean);
    if (words.length === 0) return '';
    if (words.length === 1) return words[0].slice(0, 6).toUpperCase();
    return words
      .map((w) => w[0])
      .join('')
      .slice(0, 6)
      .toUpperCase();
  }

  function onNameChange(value: string) {
    setName(value);
    if (!key) setKey(suggestKey(value));
  }

  async function onCreate() {
    if (creating || !name.trim() || !key.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await client.createWorkspace({ name: name.trim(), key: key.trim().toUpperCase() });
      setName('');
      setKey('');
      setOpen(false);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create workspace');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Pressable
          accessibilityRole="button"
          className="text-sidebar-foreground/70 hover:bg-sidebar-accent rounded p-1"
          hitSlop={8}>
          <Icon as={PlusIcon} className="size-4" />
        </Pressable>
      </DialogTrigger>
      <DialogContent className="w-full max-w-sm">
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
          <DialogDescription>
            Workspaces group tasks (like a project). They seed with Backlog, In Progress, and
            Done statuses.
          </DialogDescription>
        </DialogHeader>
        <View className="gap-4">
          <View className="gap-1.5">
            <Label nativeID="ws-name-label">Name</Label>
            <Input
              aria-labelledby="ws-name-label"
              placeholder="Marketing Site"
              value={name}
              onChangeText={onNameChange}
            />
          </View>
          <View className="gap-1.5">
            <Label nativeID="ws-key-label">Key</Label>
            <Input
              aria-labelledby="ws-key-label"
              autoCapitalize="characters"
              placeholder="MKTS"
              value={key}
              onChangeText={(v) => setKey(v.toUpperCase())}
              maxLength={6}
            />
            <Text className="text-muted-foreground text-xs">
              2-6 uppercase letters/digits, used in task keys like MKTS-42.
            </Text>
          </View>
          {error ? <Text className="text-destructive text-sm">{error}</Text> : null}
        </View>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">
              <Text>Cancel</Text>
            </Button>
          </DialogClose>
          <Button onPress={onCreate} disabled={creating || !name.trim() || !key.trim()}>
            <Text>{creating ? 'Creating...' : 'Create workspace'}</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
