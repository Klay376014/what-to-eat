export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
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
      meals: {
        Row: {
          created_at: string;
          date: string;
          id: string;
          label: string | null;
          position: number;
          slot: Database["public"]["Enums"]["meal_slot"];
          trip_id: string;
        };
        Insert: {
          created_at?: string;
          date: string;
          id?: string;
          label?: string | null;
          position?: never;
          slot: Database["public"]["Enums"]["meal_slot"];
          trip_id: string;
        };
        Update: {
          created_at?: string;
          date?: string;
          id?: string;
          label?: string | null;
          position?: never;
          slot?: Database["public"]["Enums"]["meal_slot"];
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
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
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
        Args: { token: string };
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
      meal_slot: ["breakfast", "lunch", "dinner", "other"],
      trip_role: ["organiser", "member"],
    },
  },
} as const;
