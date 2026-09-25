export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      calendar_events: {
        Row: {
          calendar_id: string | null;
          claimed_until: string | null;
          error: string | null;
          event_id: string | null;
          meal_id: string;
          queued_at: string;
          revision: number;
          status: Database["public"]["Enums"]["calendar_sync_status"];
          synced_at: string | null;
          trip_id: string;
        };
        Insert: {
          calendar_id?: string | null;
          claimed_until?: string | null;
          error?: string | null;
          event_id?: string | null;
          meal_id: string;
          queued_at?: string;
          revision?: number;
          status?: Database["public"]["Enums"]["calendar_sync_status"];
          synced_at?: string | null;
          trip_id: string;
        };
        Update: {
          calendar_id?: string | null;
          claimed_until?: string | null;
          error?: string | null;
          event_id?: string | null;
          meal_id?: string;
          queued_at?: string;
          revision?: number;
          status?: Database["public"]["Enums"]["calendar_sync_status"];
          synced_at?: string | null;
          trip_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "calendar_events_meal_id_fkey";
            columns: ["meal_id"];
            isOneToOne: true;
            referencedRelation: "meals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "calendar_events_trip_id_fkey";
            columns: ["trip_id"];
            isOneToOne: false;
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
        ];
      };
      calendar_grants: {
        Row: {
          calendar_id: string | null;
          connected_at: string;
          holder_id: string;
          refresh_token: string;
          trip_id: string;
        };
        Insert: {
          calendar_id?: string | null;
          connected_at?: string;
          holder_id: string;
          refresh_token: string;
          trip_id: string;
        };
        Update: {
          calendar_id?: string | null;
          connected_at?: string;
          holder_id?: string;
          refresh_token?: string;
          trip_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "calendar_grants_trip_id_fkey";
            columns: ["trip_id"];
            isOneToOne: true;
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
        ];
      };
      calendar_opt_outs: {
        Row: {
          created_at: string;
          trip_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          trip_id: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          trip_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "calendar_opt_outs_trip_id_user_id_fkey";
            columns: ["trip_id", "user_id"];
            isOneToOne: true;
            referencedRelation: "trip_members";
            referencedColumns: ["trip_id", "user_id"];
          },
        ];
      };
      decisions: {
        Row: {
          decided_at: string;
          decided_by: string | null;
          meal_id: string;
          proposal_id: string;
        };
        Insert: {
          decided_at?: string;
          decided_by?: string | null;
          meal_id: string;
          proposal_id: string;
        };
        Update: {
          decided_at?: string;
          decided_by?: string | null;
          meal_id?: string;
          proposal_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "decisions_meal_id_fkey";
            columns: ["meal_id"];
            isOneToOne: true;
            referencedRelation: "meals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "decisions_proposal_fkey";
            columns: ["proposal_id", "meal_id"];
            isOneToOne: false;
            referencedRelation: "proposals";
            referencedColumns: ["id", "meal_id"];
          },
        ];
      };
      invitations: {
        Row: {
          created_at: string;
          created_by: string | null;
          expires_at: string;
          id: string;
          revoked_at: string | null;
          token: string;
          trip_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          expires_at?: string;
          id?: string;
          revoked_at?: string | null;
          token: string;
          trip_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          expires_at?: string;
          id?: string;
          revoked_at?: string | null;
          token?: string;
          trip_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invitations_trip_id_fkey";
            columns: ["trip_id"];
            isOneToOne: false;
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
        ];
      };
      maps_links: {
        Row: {
          lat: number | null;
          lng: number | null;
          place_cid: string | null;
          place_name: string | null;
          resolved_at: string;
          source_url: string;
        };
        Insert: {
          lat?: number | null;
          lng?: number | null;
          place_cid?: string | null;
          place_name?: string | null;
          resolved_at?: string;
          source_url: string;
        };
        Update: {
          lat?: number | null;
          lng?: number | null;
          place_cid?: string | null;
          place_name?: string | null;
          resolved_at?: string;
          source_url?: string;
        };
        Relationships: [];
      };
      meals: {
        Row: {
          created_at: string;
          date: string;
          id: string;
          label: string | null;
          position: number;
          slot: Database["public"]["Enums"]["meal_slot"];
          start_time: string | null;
          trip_id: string;
        };
        Insert: {
          created_at?: string;
          date: string;
          id?: string;
          label?: string | null;
          position?: never;
          slot: Database["public"]["Enums"]["meal_slot"];
          start_time?: string | null;
          trip_id: string;
        };
        Update: {
          created_at?: string;
          date?: string;
          id?: string;
          label?: string | null;
          position?: never;
          slot?: Database["public"]["Enums"]["meal_slot"];
          start_time?: string | null;
          trip_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "meals_trip_id_fkey";
            columns: ["trip_id"];
            isOneToOne: false;
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          display_name: string | null;
          id: string;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          display_name?: string | null;
          id: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          display_name?: string | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      proposals: {
        Row: {
          created_at: string;
          id: string;
          lat: number | null;
          lng: number | null;
          meal_id: string;
          name_locked_at: string | null;
          note: string | null;
          place_cid: string | null;
          place_name: string;
          proposed_by: string | null;
          source_url: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          lat?: number | null;
          lng?: number | null;
          meal_id: string;
          name_locked_at?: string | null;
          note?: string | null;
          place_cid?: string | null;
          place_name: string;
          proposed_by?: string | null;
          source_url?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          lat?: number | null;
          lng?: number | null;
          meal_id?: string;
          name_locked_at?: string | null;
          note?: string | null;
          place_cid?: string | null;
          place_name?: string;
          proposed_by?: string | null;
          source_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "proposals_meal_id_fkey";
            columns: ["meal_id"];
            isOneToOne: false;
            referencedRelation: "meals";
            referencedColumns: ["id"];
          },
        ];
      };
      trip_members: {
        Row: {
          joined_at: string;
          left_at: string | null;
          role: Database["public"]["Enums"]["trip_role"];
          trip_id: string;
          user_id: string;
        };
        Insert: {
          joined_at?: string;
          left_at?: string | null;
          role?: Database["public"]["Enums"]["trip_role"];
          trip_id: string;
          user_id: string;
        };
        Update: {
          joined_at?: string;
          left_at?: string | null;
          role?: Database["public"]["Enums"]["trip_role"];
          trip_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "trip_members_trip_id_fkey";
            columns: ["trip_id"];
            isOneToOne: false;
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
        ];
      };
      trips: {
        Row: {
          created_at: string;
          end_date: string | null;
          id: string;
          name: string;
          start_date: string | null;
          timezone: string;
        };
        Insert: {
          created_at?: string;
          end_date?: string | null;
          id?: string;
          name: string;
          start_date?: string | null;
          timezone: string;
        };
        Update: {
          created_at?: string;
          end_date?: string | null;
          id?: string;
          name?: string;
          start_date?: string | null;
          timezone?: string;
        };
        Relationships: [];
      };
      votes: {
        Row: {
          created_at: string;
          proposal_id: string;
          value: number;
          voter_id: string;
        };
        Insert: {
          created_at?: string;
          proposal_id: string;
          value: number;
          voter_id?: string;
        };
        Update: {
          created_at?: string;
          proposal_id?: string;
          value?: number;
          voter_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "votes_proposal_id_fkey";
            columns: ["proposal_id"];
            isOneToOne: false;
            referencedRelation: "proposals";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      calendar_attendees: { Args: { trip_id: string }; Returns: string[] };
      cast_vote: {
        Args: { proposal_id: string; value: number };
        Returns: undefined;
      };
      claim_calendar_events: {
        Args: { trip_id: string };
        Returns: {
          date: string;
          event_id: string | null;
          label: string | null;
          lat: number | null;
          lng: number | null;
          meal_id: string;
          note: string | null;
          place_name: string | null;
          revision: number;
          slot: Database["public"]["Enums"]["meal_slot"];
          source_url: string | null;
          start_time: string | null;
        }[];
      };
      create_invitation: {
        Args: { trip_id: string };
        Returns: {
          created_at: string;
          created_by: string | null;
          expires_at: string;
          id: string;
          revoked_at: string | null;
          token: string;
          trip_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "invitations";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      finish_calendar_event: {
        Args: {
          calendar_id: string | null;
          error: string | null;
          event_id: string | null;
          meal_id: string;
          revision: number;
        };
        Returns: undefined;
      };
      create_trip: {
        Args: {
          end_date?: string;
          name: string;
          start_date?: string;
          timezone: string;
        };
        Returns: {
          created_at: string;
          end_date: string | null;
          id: string;
          name: string;
          start_date: string | null;
          timezone: string;
        };
        SetofOptions: {
          from: "*";
          to: "trips";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      join_trip: {
        Args: { calendar_attendee?: boolean; token: string };
        Returns: {
          joined: boolean;
          trip_id: string;
        }[];
      };
      keepalive: { Args: never; Returns: number };
      leave_trip: { Args: { trip_id: string }; Returns: undefined };
      remove_member: {
        Args: { trip_id: string; user_id: string };
        Returns: undefined;
      };
      revoke_invitation: {
        Args: { invitation_id: string };
        Returns: undefined;
      };
      transfer_organiser: {
        Args: { trip_id: string; user_id: string };
        Returns: undefined;
      };
    };
    Enums: {
      calendar_sync_status: "pending" | "synced" | "failed";
      meal_slot: "breakfast" | "lunch" | "dinner" | "other";
      trip_role: "organiser" | "member";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      calendar_sync_status: ["pending", "synced", "failed"],
      meal_slot: ["breakfast", "lunch", "dinner", "other"],
      trip_role: ["organiser", "member"],
    },
  },
} as const;
