export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      category_aspects_cache: {
        Row: {
          aspects: Json;
          category_id: string;
          category_name: string | null;
          category_tree_id: string;
          created_at: string;
          expires_at: string;
          fetched_at: string;
          marketplace_id: string;
          updated_at: string;
        };
        Insert: {
          aspects?: Json;
          category_id: string;
          category_name?: string | null;
          category_tree_id?: string;
          created_at?: string;
          expires_at?: string;
          fetched_at?: string;
          marketplace_id?: string;
          updated_at?: string;
        };
        Update: {
          aspects?: Json;
          category_id?: string;
          category_name?: string | null;
          category_tree_id?: string;
          created_at?: string;
          expires_at?: string;
          fetched_at?: string;
          marketplace_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      category_hygiene_log: {
        Row: {
          error: string | null;
          id: number;
          results: Json | null;
          run_at: string;
          status: string;
        };
        Insert: {
          error?: string | null;
          id?: number;
          results?: Json | null;
          run_at?: string;
          status: string;
        };
        Update: {
          error?: string | null;
          id?: number;
          results?: Json | null;
          run_at?: string;
          status?: string;
        };
        Relationships: [];
      };
      category_mappings: {
        Row: {
          breadcrumb: string | null;
          category_name: string | null;
          coin_type: string;
          confidence: number | null;
          created_at: string | null;
          ebay_category_id: string;
          effective_score: number | null;
          id: string;
          item_type: string | null;
          item_type_normalized: string | null;
          last_publish_success: string | null;
          publish_failure_count: number | null;
          publish_success_count: number | null;
          status: string;
          updated_at: string | null;
          verification_source: string | null;
          verified_at: string | null;
        };
        Insert: {
          breadcrumb?: string | null;
          category_name?: string | null;
          coin_type: string;
          confidence?: number | null;
          created_at?: string | null;
          ebay_category_id: string;
          effective_score?: number | null;
          id?: string;
          item_type?: string | null;
          item_type_normalized?: string | null;
          last_publish_success?: string | null;
          publish_failure_count?: number | null;
          publish_success_count?: number | null;
          status?: string;
          updated_at?: string | null;
          verification_source?: string | null;
          verified_at?: string | null;
        };
        Update: {
          breadcrumb?: string | null;
          category_name?: string | null;
          coin_type?: string;
          confidence?: number | null;
          created_at?: string | null;
          ebay_category_id?: string;
          effective_score?: number | null;
          id?: string;
          item_type?: string | null;
          item_type_normalized?: string | null;
          last_publish_success?: string | null;
          publish_failure_count?: number | null;
          publish_success_count?: number | null;
          status?: string;
          updated_at?: string | null;
          verification_source?: string | null;
          verified_at?: string | null;
        };
        Relationships: [];
      };
      competitor_prices: {
        Row: {
          avg_price: number | null;
          competitor_count: number | null;
          ebay_listing_id: string;
          expires_at: string;
          fetched_at: string;
          gemini_search_query: string | null;
          id: string;
          max_price: number | null;
          median_price: number | null;
          min_price: number | null;
          price_delta: number | null;
          price_distribution: Json | null;
          search_query: string;
          user_id: string;
          your_price: number | null;
        };
        Insert: {
          avg_price?: number | null;
          competitor_count?: number | null;
          ebay_listing_id: string;
          expires_at?: string;
          fetched_at?: string;
          gemini_search_query?: string | null;
          id?: string;
          max_price?: number | null;
          median_price?: number | null;
          min_price?: number | null;
          price_delta?: number | null;
          price_distribution?: Json | null;
          search_query: string;
          user_id: string;
          your_price?: number | null;
        };
        Update: {
          avg_price?: number | null;
          competitor_count?: number | null;
          ebay_listing_id?: string;
          expires_at?: string;
          fetched_at?: string;
          gemini_search_query?: string | null;
          id?: string;
          max_price?: number | null;
          median_price?: number | null;
          min_price?: number | null;
          price_delta?: number | null;
          price_distribution?: Json | null;
          search_query?: string;
          user_id?: string;
          your_price?: number | null;
        };
        Relationships: [];
      };
      cost_alerts: {
        Row: {
          id: string;
          sent_at: string;
          threshold: number;
          total_cost: number;
          total_requests: number;
        };
        Insert: {
          id?: string;
          sent_at?: string;
          threshold?: number;
          total_cost: number;
          total_requests: number;
        };
        Update: {
          id?: string;
          sent_at?: string;
          threshold?: number;
          total_cost?: number;
          total_requests?: number;
        };
        Relationships: [];
      };
      drafts: {
        Row: {
          auction_buy_it_now: number | null;
          auction_duration: string | null;
          auction_start_price: number | null;
          cogs: number | null;
          cogs_acquired_at: string | null;
          cogs_source: string | null;
          condition: string | null;
          condition_id: string | null;
          consignor: string | null;
          created_at: string;
          description: string | null;
          domain: string | null;
          ebay_category_breadcrumb: string | null;
          ebay_category_id: string | null;
          ebay_category_name: string | null;
          ebay_listing_id: string | null;
          ebay_offer_id: string | null;
          ebay_sku: string | null;
          ebay_video_id: string | null;
          ebay_video_status: string | null;
          fulfillment_policy_id: string | null;
          id: string;
          image_url: string | null;
          image_urls: string[] | null;
          item_specifics: Json | null;
          last_publish_error: string | null;
          listing_format: string | null;
          listing_id: string | null;
          listing_price: number | null;
          media_retention_last_checked: string | null;
          metal_type: string | null;
          metal_weight_oz: number | null;
          org_id: string | null;
          package_height_in: number | null;
          package_length_in: number | null;
          package_weight_lb: number | null;
          package_weight_oz: number | null;
          package_width_in: number | null;
          payment_policy_id: string | null;
          price: number | null;
          price_max: number | null;
          price_min: number | null;
          pricing_mode: string;
          publish_status: string;
          published_at: string | null;
          quantity: number;
          return_policy_id: string | null;
          status: string;
          title: string;
          updated_at: string;
          user_id: string;
          video_url: string | null;
        };
        Insert: {
          auction_buy_it_now?: number | null;
          auction_duration?: string | null;
          auction_start_price?: number | null;
          cogs?: number | null;
          cogs_acquired_at?: string | null;
          cogs_source?: string | null;
          condition?: string | null;
          condition_id?: string | null;
          consignor?: string | null;
          created_at?: string;
          description?: string | null;
          domain?: string | null;
          ebay_category_breadcrumb?: string | null;
          ebay_category_id?: string | null;
          ebay_category_name?: string | null;
          ebay_listing_id?: string | null;
          ebay_offer_id?: string | null;
          ebay_sku?: string | null;
          ebay_video_id?: string | null;
          ebay_video_status?: string | null;
          fulfillment_policy_id?: string | null;
          id?: string;
          image_url?: string | null;
          image_urls?: string[] | null;
          item_specifics?: Json | null;
          last_publish_error?: string | null;
          listing_format?: string | null;
          listing_id?: string | null;
          listing_price?: number | null;
          media_retention_last_checked?: string | null;
          metal_type?: string | null;
          metal_weight_oz?: number | null;
          org_id?: string | null;
          package_height_in?: number | null;
          package_length_in?: number | null;
          package_weight_lb?: number | null;
          package_weight_oz?: number | null;
          package_width_in?: number | null;
          payment_policy_id?: string | null;
          price?: number | null;
          price_max?: number | null;
          price_min?: number | null;
          pricing_mode?: string;
          publish_status?: string;
          published_at?: string | null;
          quantity?: number;
          return_policy_id?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
          user_id: string;
          video_url?: string | null;
        };
        Update: {
          auction_buy_it_now?: number | null;
          auction_duration?: string | null;
          auction_start_price?: number | null;
          cogs?: number | null;
          cogs_acquired_at?: string | null;
          cogs_source?: string | null;
          condition?: string | null;
          condition_id?: string | null;
          consignor?: string | null;
          created_at?: string;
          description?: string | null;
          domain?: string | null;
          ebay_category_breadcrumb?: string | null;
          ebay_category_id?: string | null;
          ebay_category_name?: string | null;
          ebay_listing_id?: string | null;
          ebay_offer_id?: string | null;
          ebay_sku?: string | null;
          ebay_video_id?: string | null;
          ebay_video_status?: string | null;
          fulfillment_policy_id?: string | null;
          id?: string;
          image_url?: string | null;
          image_urls?: string[] | null;
          item_specifics?: Json | null;
          last_publish_error?: string | null;
          listing_format?: string | null;
          listing_id?: string | null;
          listing_price?: number | null;
          media_retention_last_checked?: string | null;
          metal_type?: string | null;
          metal_weight_oz?: number | null;
          org_id?: string | null;
          package_height_in?: number | null;
          package_length_in?: number | null;
          package_weight_lb?: number | null;
          package_weight_oz?: number | null;
          package_width_in?: number | null;
          payment_policy_id?: string | null;
          price?: number | null;
          price_max?: number | null;
          price_min?: number | null;
          pricing_mode?: string;
          publish_status?: string;
          published_at?: string | null;
          quantity?: number;
          return_policy_id?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
          video_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "drafts_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      ebay_taxonomy_cache: {
        Row: {
          breadcrumb: string;
          category_id: string;
          category_name: string;
          created_at: string;
          is_leaf: boolean;
          parent_category_id: string | null;
          synced_at: string;
          updated_at: string;
        };
        Insert: {
          breadcrumb: string;
          category_id: string;
          category_name: string;
          created_at?: string;
          is_leaf?: boolean;
          parent_category_id?: string | null;
          synced_at?: string;
          updated_at?: string;
        };
        Update: {
          breadcrumb?: string;
          category_id?: string;
          category_name?: string;
          created_at?: string;
          is_leaf?: boolean;
          parent_category_id?: string | null;
          synced_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      ebay_taxonomy_meta: {
        Row: {
          category_tree_id: string;
          category_tree_version: string;
          created_at: string;
          leaf_count: number | null;
          synced_at: string;
          updated_at: string;
        };
        Insert: {
          category_tree_id: string;
          category_tree_version: string;
          created_at?: string;
          leaf_count?: number | null;
          synced_at?: string;
          updated_at?: string;
        };
        Update: {
          category_tree_id?: string;
          category_tree_version?: string;
          created_at?: string;
          leaf_count?: number | null;
          synced_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      gemini_usage: {
        Row: {
          completion_tokens: number;
          cost_usd: number;
          created_at: string;
          function_name: string;
          id: string;
          model: string;
          prompt_tokens: number;
          provider: string;
          total_tokens: number;
          user_id: string | null;
        };
        Insert: {
          completion_tokens?: number;
          cost_usd?: number;
          created_at?: string;
          function_name: string;
          id?: string;
          model: string;
          prompt_tokens?: number;
          provider?: string;
          total_tokens?: number;
          user_id?: string | null;
        };
        Update: {
          completion_tokens?: number;
          cost_usd?: number;
          created_at?: string;
          function_name?: string;
          id?: string;
          model?: string;
          prompt_tokens?: number;
          provider?: string;
          total_tokens?: number;
          user_id?: string | null;
        };
        Relationships: [];
      };
      knowledge_base: {
        Row: {
          category: string;
          content: string;
          created_at: string | null;
          embedding: string | null;
          id: string;
          metadata: Json | null;
        };
        Insert: {
          category: string;
          content: string;
          created_at?: string | null;
          embedding?: string | null;
          id?: string;
          metadata?: Json | null;
        };
        Update: {
          category?: string;
          content?: string;
          created_at?: string | null;
          embedding?: string | null;
          id?: string;
          metadata?: Json | null;
        };
        Relationships: [];
      };
      listing_cogs: {
        Row: {
          acquired_at: string | null;
          cogs: number;
          cogs_source: string;
          created_at: string;
          ebay_listing_id: string | null;
          ebay_sku: string | null;
          id: string;
          org_id: string | null;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          acquired_at?: string | null;
          cogs?: number;
          cogs_source?: string;
          created_at?: string;
          ebay_listing_id?: string | null;
          ebay_sku?: string | null;
          id?: string;
          org_id?: string | null;
          title?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          acquired_at?: string | null;
          cogs?: number;
          cogs_source?: string;
          created_at?: string;
          ebay_listing_id?: string | null;
          ebay_sku?: string | null;
          id?: string;
          org_id?: string | null;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "listing_cogs_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      listing_financials: {
        Row: {
          cogs: number | null;
          created_at: string;
          domain: string | null;
          ebay_fees: number;
          ebay_listing_id: string | null;
          ebay_sku: string | null;
          id: string;
          net_profit: number;
          order_id: string;
          quantity: number;
          refund: number;
          sale_price: number;
          shipping_buyer_paid: number;
          shipping_label_cost: number | null;
          sold_at: string;
          time_to_sale_days: number | null;
          title: string;
          unit_cogs: number | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          cogs?: number | null;
          created_at?: string;
          domain?: string | null;
          ebay_fees?: number;
          ebay_listing_id?: string | null;
          ebay_sku?: string | null;
          id?: string;
          net_profit?: number;
          order_id: string;
          quantity?: number;
          refund?: number;
          sale_price?: number;
          shipping_buyer_paid?: number;
          shipping_label_cost?: number | null;
          sold_at: string;
          time_to_sale_days?: number | null;
          title?: string;
          unit_cogs?: number | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          cogs?: number | null;
          created_at?: string;
          domain?: string | null;
          ebay_fees?: number;
          ebay_listing_id?: string | null;
          ebay_sku?: string | null;
          id?: string;
          net_profit?: number;
          order_id?: string;
          quantity?: number;
          refund?: number;
          sale_price?: number;
          shipping_buyer_paid?: number;
          shipping_label_cost?: number | null;
          sold_at?: string;
          time_to_sale_days?: number | null;
          title?: string;
          unit_cogs?: number | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      lookup_decisions: {
        Row: {
          candidate_id: string | null;
          candidate_name: string | null;
          candidate_rank: number | null;
          candidate_score: number | null;
          candidate_source: string;
          created_at: string;
          id: number;
          latency_ms: number | null;
          persisted_to_db: boolean | null;
          query_text: string | null;
          reason_selected: string | null;
          request_id: string;
          verified_active: boolean | null;
          verified_leaf: boolean | null;
          was_selected: boolean | null;
        };
        Insert: {
          candidate_id?: string | null;
          candidate_name?: string | null;
          candidate_rank?: number | null;
          candidate_score?: number | null;
          candidate_source: string;
          created_at?: string;
          id?: number;
          latency_ms?: number | null;
          persisted_to_db?: boolean | null;
          query_text?: string | null;
          reason_selected?: string | null;
          request_id: string;
          verified_active?: boolean | null;
          verified_leaf?: boolean | null;
          was_selected?: boolean | null;
        };
        Update: {
          candidate_id?: string | null;
          candidate_name?: string | null;
          candidate_rank?: number | null;
          candidate_score?: number | null;
          candidate_source?: string;
          created_at?: string;
          id?: number;
          latency_ms?: number | null;
          persisted_to_db?: boolean | null;
          query_text?: string | null;
          reason_selected?: string | null;
          request_id?: string;
          verified_active?: boolean | null;
          verified_leaf?: boolean | null;
          was_selected?: boolean | null;
        };
        Relationships: [];
      };
      market_price_history: {
        Row: {
          active_count: number | null;
          avg_price: number | null;
          id: string;
          max_price: number | null;
          median_price: number | null;
          min_price: number | null;
          sampled_at: string | null;
          sell_through_rate: number | null;
          sold_count: number | null;
          watch_id: string;
        };
        Insert: {
          active_count?: number | null;
          avg_price?: number | null;
          id?: string;
          max_price?: number | null;
          median_price?: number | null;
          min_price?: number | null;
          sampled_at?: string | null;
          sell_through_rate?: number | null;
          sold_count?: number | null;
          watch_id: string;
        };
        Update: {
          active_count?: number | null;
          avg_price?: number | null;
          id?: string;
          max_price?: number | null;
          median_price?: number | null;
          min_price?: number | null;
          sampled_at?: string | null;
          sell_through_rate?: number | null;
          sold_count?: number | null;
          watch_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "market_price_history_watch_id_fkey";
            columns: ["watch_id"];
            isOneToOne: false;
            referencedRelation: "market_watches";
            referencedColumns: ["id"];
          },
        ];
      };
      market_watches: {
        Row: {
          active_count: number | null;
          avg_price: number | null;
          category_id: string | null;
          created_at: string | null;
          id: string;
          label: string | null;
          last_checked_at: string | null;
          max_price: number | null;
          median_price: number | null;
          min_price: number | null;
          org_id: string | null;
          search_query: string;
          sell_through_rate: number | null;
          sold_count: number | null;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          active_count?: number | null;
          avg_price?: number | null;
          category_id?: string | null;
          created_at?: string | null;
          id?: string;
          label?: string | null;
          last_checked_at?: string | null;
          max_price?: number | null;
          median_price?: number | null;
          min_price?: number | null;
          org_id?: string | null;
          search_query: string;
          sell_through_rate?: number | null;
          sold_count?: number | null;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          active_count?: number | null;
          avg_price?: number | null;
          category_id?: string | null;
          created_at?: string | null;
          id?: string;
          label?: string | null;
          last_checked_at?: string | null;
          max_price?: number | null;
          median_price?: number | null;
          min_price?: number | null;
          org_id?: string | null;
          search_query?: string;
          sell_through_rate?: number | null;
          sold_count?: number | null;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "market_watches_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      optimization_history: {
        Row: {
          applied_at: string | null;
          applied_by: string | null;
          created_at: string | null;
          id: string;
          listing_id: string;
          listing_title: string | null;
          new_value: string | null;
          old_value: string | null;
          optimization_type: string;
          reasoning: string | null;
          result: string | null;
          user_id: string;
        };
        Insert: {
          applied_at?: string | null;
          applied_by?: string | null;
          created_at?: string | null;
          id?: string;
          listing_id: string;
          listing_title?: string | null;
          new_value?: string | null;
          old_value?: string | null;
          optimization_type: string;
          reasoning?: string | null;
          result?: string | null;
          user_id: string;
        };
        Update: {
          applied_at?: string | null;
          applied_by?: string | null;
          created_at?: string | null;
          id?: string;
          listing_id?: string;
          listing_title?: string | null;
          new_value?: string | null;
          old_value?: string | null;
          optimization_type?: string;
          reasoning?: string | null;
          result?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      org_invitations: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          invited_by: string;
          org_id: string;
          status: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          invited_by: string;
          org_id: string;
          status?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          invited_by?: string;
          org_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "org_invitations_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      org_members: {
        Row: {
          created_at: string;
          id: string;
          org_id: string;
          role: Database["public"]["Enums"]["org_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          org_id: string;
          role?: Database["public"]["Enums"]["org_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          org_id?: string;
          role?: Database["public"]["Enums"]["org_role"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "org_members_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          created_at: string;
          free_tier_reset_day: number | null;
          id: string;
          name: string;
          owner_id: string;
        };
        Insert: {
          created_at?: string;
          free_tier_reset_day?: number | null;
          id?: string;
          name: string;
          owner_id: string;
        };
        Update: {
          created_at?: string;
          free_tier_reset_day?: number | null;
          id?: string;
          name?: string;
          owner_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          city: string | null;
          created_at: string;
          display_name: string | null;
          ebay_access_token: string | null;
          ebay_account_type: string | null;
          ebay_refresh_token: string | null;
          ebay_token_expires_at: string | null;
          ebay_username: string | null;
          id: string;
          last_ebay_sync_at: string | null;
          next_sku_sequence: number;
          postal_code: string | null;
          stripe_customer_id: string | null;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          city?: string | null;
          created_at?: string;
          display_name?: string | null;
          ebay_access_token?: string | null;
          ebay_account_type?: string | null;
          ebay_refresh_token?: string | null;
          ebay_token_expires_at?: string | null;
          ebay_username?: string | null;
          id: string;
          last_ebay_sync_at?: string | null;
          next_sku_sequence?: number;
          postal_code?: string | null;
          stripe_customer_id?: string | null;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          city?: string | null;
          created_at?: string;
          display_name?: string | null;
          ebay_access_token?: string | null;
          ebay_account_type?: string | null;
          ebay_refresh_token?: string | null;
          ebay_token_expires_at?: string | null;
          ebay_username?: string | null;
          id?: string;
          last_ebay_sync_at?: string | null;
          next_sku_sequence?: number;
          postal_code?: string | null;
          stripe_customer_id?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      reprice_rules: {
        Row: {
          adjustment_pct: number | null;
          category_filter: string | null;
          ceiling_price: number | null;
          created_at: string | null;
          floor_price: number | null;
          id: string;
          is_enabled: boolean | null;
          rule_name: string;
          rule_type: string;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          adjustment_pct?: number | null;
          category_filter?: string | null;
          ceiling_price?: number | null;
          created_at?: string | null;
          floor_price?: number | null;
          id?: string;
          is_enabled?: boolean | null;
          rule_name: string;
          rule_type: string;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          adjustment_pct?: number | null;
          category_filter?: string | null;
          ceiling_price?: number | null;
          created_at?: string | null;
          floor_price?: number | null;
          id?: string;
          is_enabled?: boolean | null;
          rule_name?: string;
          rule_type?: string;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      spot_price_cache: {
        Row: {
          fetched_at: string;
          gold: number;
          id: number;
          platinum: number;
          silver: number;
          source: string;
        };
        Insert: {
          fetched_at?: string;
          gold: number;
          id?: number;
          platinum: number;
          silver: number;
          source?: string;
        };
        Update: {
          fetched_at?: string;
          gold?: number;
          id?: number;
          platinum?: number;
          silver?: number;
          source?: string;
        };
        Relationships: [];
      };
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean | null;
          current_period_end: string | null;
          id: string;
          org_id: string | null;
          price_id: string | null;
          product_id: string | null;
          status: string;
          stripe_cust_id: string | null;
          stripe_sub_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          cancel_at_period_end?: boolean | null;
          current_period_end?: string | null;
          id?: string;
          org_id?: string | null;
          price_id?: string | null;
          product_id?: string | null;
          status?: string;
          stripe_cust_id?: string | null;
          stripe_sub_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          cancel_at_period_end?: boolean | null;
          current_period_end?: string | null;
          id?: string;
          org_id?: string | null;
          price_id?: string | null;
          product_id?: string | null;
          status?: string;
          stripe_cust_id?: string | null;
          stripe_sub_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subscriptions_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      support_tickets: {
        Row: {
          created_at: string;
          description: string;
          id: string;
          status: string;
          subject: string;
          type: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          description?: string;
          id?: string;
          status?: string;
          subject: string;
          type?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          description?: string;
          id?: string;
          status?: string;
          subject?: string;
          type?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      test_items: {
        Row: {
          cogs: number | null;
          condition: string | null;
          created_at: string;
          description: string;
          domain: string;
          ebay_category_id: string | null;
          id: string;
          image_url: string;
          image_urls: string[] | null;
          item_specifics: Json | null;
          listing_format: string | null;
          listing_price: number;
          metal_type: string | null;
          metal_weight_oz: number | null;
          price_max: number;
          price_min: number;
          publish_status: string | null;
          title: string;
          user_id: string;
        };
        Insert: {
          cogs?: number | null;
          condition?: string | null;
          created_at?: string;
          description?: string;
          domain: string;
          ebay_category_id?: string | null;
          id?: string;
          image_url?: string;
          image_urls?: string[] | null;
          item_specifics?: Json | null;
          listing_format?: string | null;
          listing_price?: number;
          metal_type?: string | null;
          metal_weight_oz?: number | null;
          price_max?: number;
          price_min?: number;
          publish_status?: string | null;
          title: string;
          user_id?: string;
        };
        Update: {
          cogs?: number | null;
          condition?: string | null;
          created_at?: string;
          description?: string;
          domain?: string;
          ebay_category_id?: string | null;
          id?: string;
          image_url?: string;
          image_urls?: string[] | null;
          item_specifics?: Json | null;
          listing_format?: string | null;
          listing_price?: number;
          metal_type?: string | null;
          metal_weight_oz?: number | null;
          price_max?: number;
          price_min?: number;
          publish_status?: string | null;
          title?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      usage_tracking: {
        Row: {
          action_type: string;
          created_at: string;
          id: string;
          org_id: string | null;
          user_id: string;
        };
        Insert: {
          action_type: string;
          created_at?: string;
          id?: string;
          org_id?: string | null;
          user_id: string;
        };
        Update: {
          action_type?: string;
          created_at?: string;
          id?: string;
          org_id?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "usage_tracking_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      user_active_listings: {
        Row: {
          category_id: string | null;
          ebay_listing_id: string;
          first_seen_at: string;
          id: string;
          last_seen_at: string;
          price: number | null;
          title: string;
          user_id: string;
        };
        Insert: {
          category_id?: string | null;
          ebay_listing_id: string;
          first_seen_at?: string;
          id?: string;
          last_seen_at?: string;
          price?: number | null;
          title: string;
          user_id: string;
        };
        Update: {
          category_id?: string | null;
          ebay_listing_id?: string;
          first_seen_at?: string;
          id?: string;
          last_seen_at?: string;
          price?: number | null;
          title?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      domain_quality_metrics: {
        Row: {
          avg_net_profit: number | null;
          avg_sale_price: number | null;
          avg_time_to_sale_days: number | null;
          domain: string | null;
          earliest_sale: string | null;
          latest_sale: string | null;
          sold_count: number | null;
          user_id: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      accept_invitation: {
        Args: { _invitation_id: string };
        Returns: undefined;
      };
      find_duplicate_mappings: {
        Args: never;
        Returns: {
          category_id: string;
          id: string;
          item_type_normalized: string;
          verification_source: string;
        }[];
      };
      find_rotted_mappings: {
        Args: never;
        Returns: {
          cache_status: string;
          category_id: string;
          id: string;
          item_type_normalized: string;
        }[];
      };
      get_free_tier_window_start: {
        Args: { p_reset_day: number };
        Returns: string;
      };
      get_next_competitor_price_batch: {
        Args: { p_limit: number; p_stale_before: string };
        Returns: {
          category_id: string;
          ebay_listing_id: string;
          last_fetched_at: string;
          price: number;
          title: string;
          user_id: string;
        }[];
      };
      get_user_org_id: { Args: { _user_id: string }; Returns: string };
      get_users_for_inventory_sync: {
        Args: { p_limit: number; p_stale_before: string };
        Returns: {
          last_ebay_sync_at: string;
          user_id: string;
        }[];
      };
      increment_sku_sequence: { Args: { user_id: string }; Returns: number };
      is_org_member: {
        Args: { _org_id: string; _user_id: string };
        Returns: boolean;
      };
      is_org_owner: {
        Args: { _org_id: string; _user_id: string };
        Returns: boolean;
      };
      match_knowledge_base: {
        Args: {
          filter_category: string;
          match_count: number;
          match_threshold: number;
          query_embedding: string;
        };
        Returns: {
          category: string;
          content: string;
          id: string;
          metadata: Json;
          similarity: number;
        }[];
      };
    };
    Enums: {
      org_role: "owner" | "lister";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

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
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
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
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      org_role: ["owner", "lister"],
    },
  },
} as const;
