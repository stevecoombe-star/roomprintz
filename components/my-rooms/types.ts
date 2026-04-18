export type MyRoomsScope = "all" | "recents" | "folder";

export type MyRoomsSortMode = "most_recent" | "oldest" | "title_asc" | "title_desc";

export type MyRoomsFolder = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  room_count?: number;
};

export type MyRoomsRoom = {
  id: string;
  title: string;
  folder_id: string | null;
  folder_name: string | null;
  current_stage: number;
  selected_model: string | null;
  cover_image_url: string | null;
  display_image_url: string | null;
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
  sort_key: string;
  status?: string | null;
  source_type?: string | null;
};

export type MyRoomsViewState = {
  selectedScope: MyRoomsScope;
  selectedFolderId: string | null;
  searchQuery: string;
  sortMode: MyRoomsSortMode;
};
